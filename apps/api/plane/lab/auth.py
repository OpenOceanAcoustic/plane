# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Single-use enrollment and replay-safe, durable account-scoped TOTP login."""

import hashlib
import json
import math
import re
import secrets
import uuid
from datetime import timedelta
from io import BytesIO
import base64

import pyotp
import qrcode
from cryptography.fernet import Fernet
from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email, validate_slug
from django.db import connection, transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_variables

from plane.db.models import APIToken, Profile, Session, User, Workspace, WorkspaceMember
from plane.settings.redis import redis_instance
from redis.exceptions import RedisError
from plane.license.models import Instance, InstanceAdmin
from .models import Audit, Credential, Enrollment, Invitation, LoginAccount, LoginAttempt, WorkspacePolicy


class AccessError(Exception):
    def __init__(self, message="链接无效、已使用或已过期", status=400, retry_after=None):
        self.message, self.status, self.retry_after = message, status, retry_after


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def cipher():
    if not settings.LAB_TOTP_KEY:
        raise AccessError("服务器尚未配置认证密钥", 503)
    return Fernet(settings.LAB_TOTP_KEY.encode())


def audit(action, obj=None, actor=None, workspace=None, **details):
    Audit.objects.create(
        action=action,
        object_id=getattr(obj, "id", None),
        actor=actor,
        actor_name=actor.display_name if actor else "SSH",
        workspace_id_snapshot=getattr(workspace, "id", None),
        details=details,
    )


def lock(name):
    # PostgreSQL locks also serialize empty-table/bootstrap and new identities.
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(%s)",
            [int.from_bytes(hashlib.sha256(name.encode()).digest()[:8], "big", signed=True)],
        )


def usable(invitation):
    if invitation.revoked_at or invitation.consumed_at or invitation.expires_at <= timezone.now():
        raise AccessError()


def revoke_live_sessions(user_id):
    try:
        redis_instance().publish(
            "hocuspocus:admin",
            json.dumps(
                {
                    "command": "revoke_user",
                    "userId": str(user_id),
                    "originServer": "lab-ssh",
                    "timestamp": timezone.now().isoformat(),
                }
            ),
        )
    except RedisError:
        raise AccessError("账号凭据已禁用，但实时服务通知失败；请停止 live 服务并检查 Redis 后再次恢复", 503)


@transaction.atomic
@sensitive_variables()
def issue_invitation(kind, workspace=None, workspace_slug="", role=15, user=None):
    cipher()  # Fail before distributing a link that cannot be redeemed.
    if kind == "bootstrap":
        lock("lab-bootstrap")
        if (
            InstanceAdmin.objects.exists()
            or Invitation.objects.filter(
                kind="bootstrap", consumed_at__isnull=True, revoked_at__isnull=True, expires_at__gt=timezone.now()
            ).exists()
        ):
            raise AccessError("管理员已初始化或已有有效初始化邀请")
        validate_slug(workspace_slug)
        if not workspace_slug or Workspace.objects.filter(slug=workspace_slug).exists():
            raise AccessError("工作区名称不可用")
    if kind == "rebind":
        lock("lab-rebind:" + str(user.id))
        Credential.objects.get_or_create(user=user, defaults={"enabled": False, "encrypted_secret": ""})
        credential = Credential.objects.select_for_update().get(user=user)
        credential.enabled = False
        credential.generation = uuid.uuid4()
        credential.save(update_fields=["enabled", "generation"])
        user.set_unusable_password()
        user.token = secrets.token_hex(32)
        user.save(update_fields=["password", "token"])
        Session.objects.filter(user_id=str(user.id)).delete()
        APIToken.objects.filter(user=user).update(is_active=False)
        transaction.on_commit(lambda: revoke_live_sessions(user.id))
        Invitation.objects.filter(user=user, kind="rebind", consumed_at__isnull=True).update(revoked_at=timezone.now())
    token = secrets.token_urlsafe(32)
    invitation = Invitation.objects.create(
        kind=kind,
        token_hash=digest(token),
        workspace=workspace,
        workspace_slug=workspace_slug,
        role=role,
        user=user,
        expires_at=timezone.now() + timedelta(hours=24),
    )
    audit("auth." + kind, invitation, workspace=workspace)
    return invitation, token


@transaction.atomic
@sensitive_variables()
def begin_enrollment(data):
    invitation = Invitation.objects.select_for_update().filter(token_hash=digest(str(data.get("token", "")))).first()
    if not invitation:
        raise AccessError()
    usable(invitation)
    if invitation.kind == "rebind":
        user = invitation.user
        if not user or not user.is_active:
            raise AccessError()
        username, display_name, email = user.username, user.display_name, user.email
    else:
        username = str(data.get("username", "")).strip().casefold()
        display_name = str(data.get("display_name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,63}", username) or not display_name or len(display_name) > 255:
            raise AccessError("用户名为 3–64 位字母、数字、点、下划线或短横线，请填写显示姓名")
        try:
            validate_email(email)
        except ValidationError:
            raise AccessError("请填写有效联系邮箱")
        if User.objects.filter(username__iexact=username).exists() or User.objects.filter(email__iexact=email).exists():
            raise AccessError("用户名或联系邮箱已使用")
    Enrollment.objects.filter(invitation=invitation).delete()
    token, secret = secrets.token_urlsafe(32), pyotp.random_base32()
    Enrollment.objects.create(
        invitation=invitation,
        token_hash=digest(token),
        username=username,
        display_name=display_name,
        email=email,
        encrypted_secret=cipher().encrypt(secret.encode()).decode(),
    )
    uri = pyotp.TOTP(secret).provisioning_uri(username, issuer_name="OpenOceanAcoustic")
    image = qrcode.make(uri)
    output = BytesIO()
    image.save(output, format="PNG")
    return {
        "token": token,
        "otpauth": uri,
        "qr": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
        "rebind": invitation.kind == "rebind",
        "username": username,
        "expires_at": invitation.expires_at.isoformat(),
    }


@sensitive_variables()
def verified_step(encrypted_secret, code, last_step=-1):
    if not re.fullmatch(r"[0-9]{6}", str(code)):
        return None
    totp = pyotp.TOTP(cipher().decrypt(encrypted_secret.encode()).decode())
    current = int(timezone.now().timestamp()) // 30
    for step in (current, current - 1, current + 1):
        if step > last_step and secrets.compare_digest(totp.at(step * 30), str(code)):
            return step
    return None


@sensitive_variables()
def confirm_enrollment(data):
    # Incorrect submissions must commit their counter; errors are returned after the transaction.
    with transaction.atomic():
        pending = Enrollment.objects.filter(token_hash=digest(str(data.get("token", "")))).first()
        if not pending:
            raise AccessError()
        if pending.invitation.kind == "rebind":
            lock("lab-rebind:" + str(pending.invitation.user_id))
        invitation = Invitation.objects.select_for_update().get(id=pending.invitation_id)
        usable(invitation)
        pending = Enrollment.objects.select_for_update().filter(id=pending.id).first()
        if not pending or pending.attempts >= 5:
            raise AccessError("绑定请求失效，请重新打开邀请链接")
        step = verified_step(pending.encrypted_secret, data.get("code", ""))
        pending.attempts += 1
        pending.save(update_fields=["attempts"])
        if step is None:
            error = AccessError("动态码无效，请检查设备时间")
        else:
            error = None
            if invitation.kind == "rebind":
                Credential.objects.select_for_update().get(user_id=invitation.user_id)
                user = User.objects.select_for_update().get(id=invitation.user_id)
                if not user.is_active:
                    raise AccessError()
                Credential.objects.filter(user=user).update(
                    encrypted_secret=pending.encrypted_secret, last_step=step, enabled=True, generation=uuid.uuid4()
                )
            else:
                lock("lab-username:" + pending.username)
                lock("lab-email:" + pending.email)
                if (
                    User.objects.filter(username__iexact=pending.username).exists()
                    or User.objects.filter(email__iexact=pending.email).exists()
                ):
                    raise AccessError("用户名或联系邮箱已使用")
                if invitation.kind == "bootstrap":
                    lock("lab-bootstrap")
                    if InstanceAdmin.objects.exists():
                        raise AccessError()
                user = User(
                    username=pending.username,
                    display_name=pending.display_name,
                    first_name=pending.display_name,
                    email=pending.email,
                    is_staff=invitation.kind == "bootstrap",
                    is_superuser=invitation.kind == "bootstrap",
                    user_timezone="Asia/Shanghai",
                )
                user.set_unusable_password()
                user.save()
                workspace = invitation.workspace
                if invitation.kind == "bootstrap":
                    workspace = Workspace.objects.create(
                        slug=invitation.workspace_slug, name="OpenOceanAcoustic", owner=user, timezone="Asia/Shanghai"
                    )
                    instance = Instance.objects.order_by("created_at").first()
                    if not instance:
                        instance = Instance.objects.create(
                            instance_name="OpenOceanAcoustic",
                            instance_id=str(uuid.uuid4()),
                            current_version="v1.4.2",
                            last_checked_at=timezone.now(),
                        )
                    instance.is_setup_done = True
                    instance.is_signup_screen_visited = True
                    instance.is_telemetry_enabled = False
                    instance.is_support_required = False
                    instance.save()
                    InstanceAdmin.objects.create(instance=instance, user=user, is_verified=True)
                    transaction.on_commit(lambda: cache.delete("/api/instances/"))
                if not workspace:
                    raise AccessError()
                WorkspaceMember.objects.create(
                    workspace=workspace, member=user, role=20 if invitation.kind == "bootstrap" else invitation.role
                )
                WorkspacePolicy.objects.get_or_create(workspace=workspace)
                Profile.objects.update_or_create(
                    user=user,
                    defaults={
                        "is_onboarded": True,
                        "language": "zh-CN",
                        "start_of_the_week": 1,
                        "last_workspace_id": workspace.id,
                        "onboarding_step": {
                            "profile_complete": True,
                            "workspace_create": True,
                            "workspace_join": True,
                            "workspace_invite": True,
                        },
                    },
                )
                Credential.objects.create(user=user, encrypted_secret=pending.encrypted_secret, last_step=step)
            invitation.consumed_at = timezone.now()
            invitation.save(update_fields=["consumed_at"])
            audit("auth.bound", invitation, actor=user, workspace=invitation.workspace)
            Enrollment.objects.filter(invitation=invitation).delete()
    if error:
        raise error
    return user


@sensitive_variables()
def authenticate(data, request, admin=False):
    from django.contrib.auth import login

    username = str(data.get("username", "")).strip().casefold()[:128]
    result = None
    with transaction.atomic():
        account, _ = LoginAccount.objects.get_or_create(identity_hash=digest(username))
        account = LoginAccount.objects.select_for_update().get(id=account.id)
        now = timezone.now()
        LoginAttempt.objects.filter(account=account, submitted_at__lte=now - timedelta(seconds=600)).delete()
        attempts = list(LoginAttempt.objects.filter(account=account).order_by("submitted_at"))
        if len(attempts) >= 5:
            result = AccessError(
                "请求过于频繁，请稍后重试",
                429,
                max(1, math.ceil((attempts[0].submitted_at + timedelta(seconds=600) - now).total_seconds())),
            )
        else:
            LoginAttempt.objects.create(account=account, submitted_at=now)
            credential = (
                Credential.objects.select_for_update()
                .select_related("user")
                .filter(user__username__iexact=username)
                .first()
            )
            step = (
                verified_step(credential.encrypted_secret, data.get("code", ""), credential.last_step)
                if credential and credential.enabled and credential.user.is_active
                else None
            )
            if step is None or (
                admin and not InstanceAdmin.objects.filter(user=credential.user, user__is_active=True).exists()
            ):
                result = AccessError("用户名或动态码无效", 401)
            else:
                credential.last_step = step
                credential.save(update_fields=["last_step"])
                login(request, credential.user, backend="django.contrib.auth.backends.ModelBackend")
                request.session["lab_generation"] = str(credential.generation)
                request.session["device_info"] = {}
                if admin:
                    request.session.set_expiry(settings.ADMIN_SESSION_COOKIE_AGE)
                request.session.save()
    if result:
        raise result
    return credential.user
