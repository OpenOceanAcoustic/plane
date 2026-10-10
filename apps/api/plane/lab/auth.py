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
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email, validate_slug
from django.db import connection, transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_variables

from plane.db.models import APIToken, Profile, Session, User, Workspace, WorkspaceMember
from plane.settings.redis import redis_instance
from redis.exceptions import RedisError
from plane.license.models import Instance, InstanceAdmin
from .models import (
    Audit,
    Credential,
    Enrollment,
    Invitation,
    LoginAccount,
    LoginAttempt,
    TrustedBrowser,
    WorkspacePolicy,
)


class AccessError(Exception):
    def __init__(self, message="链接无效、已使用或已过期", status=400, retry_after=None, code="ACCESS_DENIED"):
        self.message, self.status, self.retry_after = message, status, retry_after
        self.code = code


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def browser_cookie_name(admin=False):
    return getattr(
        settings,
        "LAB_ADMIN_TRUSTED_BROWSER_COOKIE_NAME" if admin else "LAB_TRUSTED_BROWSER_COOKIE_NAME",
        "__Host-lab-admin-browser" if admin else "__Host-lab-browser",
    )


@sensitive_variables()
def signed_browser(request, username=None, admin=False):
    """Cheap signature classification; every use still requires a locked DB check."""
    cookie = request.COOKIES.get(browser_cookie_name(admin), "")
    if not cookie or len(cookie) > 2048:
        return None
    try:
        payload = signing.loads(cookie, salt="plane.lab.browser.v1")
        if (
            not isinstance(payload, dict)
            or payload.get("purpose") != ("admin" if admin else "user")
            or (username is not None and payload.get("username") != username)
            or not isinstance(payload.get("expires"), int)
            or payload["expires"] <= timezone.now().timestamp()
            or not re.fullmatch(r"[A-Za-z0-9_-]{43}", payload.get("token", ""))
        ):
            return None
        uuid.UUID(payload["user"])
        uuid.UUID(payload["generation"])
        return payload, digest(cookie)
    except (signing.BadSignature, ValueError, TypeError, KeyError):
        return None


def locked_browser(credential, signed, admin=False):
    if not signed or signed[0]["user"] != str(credential.user_id):
        return None
    return (
        TrustedBrowser.objects.select_for_update()
        .filter(
            token_hash=signed[1],
            user_id=credential.user_id,
            purpose="admin" if admin else "user",
            generation=credential.generation,
            expires_at__gt=timezone.now(),
            revoked_at__isnull=True,
        )
        .first()
    )


def consume_login_quota(credential, now, browser=None, session_hash=""):
    """Credential lock serializes stranger, device and reauthentication scopes."""
    account, _ = LoginAccount.objects.get_or_create(identity_hash=digest("user:" + str(credential.user_id)))
    LoginAttempt.objects.filter(account=account, submitted_at__lte=now - timedelta(seconds=600)).delete()
    attempts = list(
        LoginAttempt.objects.filter(account=account, browser=browser, session_hash=session_hash).order_by(
            "submitted_at"
        )
    )
    if len(attempts) >= 5:
        return AccessError(
            "请求过于频繁，请稍后重试",
            429,
            max(1, math.ceil((attempts[0].submitted_at + timedelta(seconds=600) - now).total_seconds())),
            code="RATE_LIMITED",
        )
    LoginAttempt.objects.create(account=account, browser=browser, session_hash=session_hash, submitted_at=now)
    return None


@sensitive_variables()
def remember_browser(credential, request, data, admin=False):
    now = timezone.now()
    purpose = "admin" if admin else "user"
    cap = getattr(settings, "LAB_ADMIN_BROWSER_LIMIT" if admin else "LAB_MEMBER_BROWSER_LIMIT", 2 if admin else 5)
    browsers = TrustedBrowser.objects.filter(
        user_id=credential.user_id,
        purpose=purpose,
        generation=credential.generation,
        revoked_at__isnull=True,
        expires_at__gt=now,
    )
    if browsers.count() >= cap:
        raise AccessError(
            "可信浏览器已达上限，请取消记住浏览器后登录并管理已有浏览器", 409, code="BROWSER_LIMIT_REACHED"
        )
    age = getattr(
        settings, "LAB_ADMIN_BROWSER_AGE" if admin else "LAB_MEMBER_BROWSER_AGE", 604800 if admin else 2592000
    )
    expires = now + timedelta(seconds=age)
    cookie = signing.dumps(
        {
            "token": secrets.token_urlsafe(32),
            "user": str(credential.user_id),
            "username": credential.user.username.casefold(),
            "purpose": purpose,
            "generation": str(credential.generation),
            "expires": int(expires.timestamp()),
        },
        salt="plane.lab.browser.v1",
    )
    browser = TrustedBrowser.objects.create(
        user_id=credential.user_id,
        token_hash=digest(cookie),
        purpose=purpose,
        generation=credential.generation,
        name=str(data.get("browser_name", "浏览器")).strip()[:120] or "浏览器",
        expires_at=expires,
        last_used_at=now,
    )
    request._lab_browser_cookie = (browser_cookie_name(admin), cookie, expires)
    return browser


def browser_cookie_response(request, response, admin=False):
    pending = getattr(request, "_lab_browser_cookie", None)
    if pending:
        name, cookie, expires = pending
        response.set_cookie(name, cookie, expires=expires, secure=True, httponly=True, samesite="Strict", path="/")
    elif getattr(request, "_lab_clear_browser", False):
        response.delete_cookie(browser_cookie_name(admin), path="/", samesite="Strict")
    return response


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
        TrustedBrowser.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
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
            # Recovery, login and device mutation always take Credential first.
            Credential.objects.select_for_update().get(user_id=pending.invitation.user_id)
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
    from django.contrib.auth import login, logout
    from .security import limit_auth, security_event

    username = str(data.get("username", "")).strip().casefold()[:128]
    signed = signed_browser(request, username, admin)
    limit_auth(request, trusted=bool(signed))
    result = None
    with transaction.atomic():
        credential = (
            Credential.objects.select_for_update(of=("self",))
            .select_related("user")
            .filter(user__username__iexact=username, enabled=True, user__is_active=True)
            .first()
        )
        now = timezone.now()
        browser = locked_browser(credential, signed, admin) if credential else None
        if signed and not browser:
            limit_auth(request, trusted=False)
        if request.COOKIES.get(browser_cookie_name(admin)) and not browser:
            request._lab_clear_browser = True
        if not credential:
            result = AccessError("用户名或动态码无效", 401, code="INVALID_CREDENTIALS")
        else:
            result = consume_login_quota(credential, now, browser)
        if credential and not result:
            step = verified_step(credential.encrypted_secret, data.get("code", ""), credential.last_step)
            if step is None or (
                admin and not InstanceAdmin.objects.filter(user=credential.user, user__is_active=True).exists()
            ):
                result = AccessError("用户名或动态码无效", 401, code="INVALID_CREDENTIALS")
            else:
                try:
                    if data.get("remember_browser") is True and not browser:
                        browser = remember_browser(credential, request, data, admin)
                except AccessError as error:
                    if error.code == "BROWSER_LIMIT_REACHED":
                        request._lab_browser_limit_reached = True
                    else:
                        result = error
                if not result:
                    credential.last_step = step
                    credential.save(update_fields=["last_step"])
                    if browser:
                        browser.last_used_at = now
                        browser.save(update_fields=["last_used_at"])
                    # A new login creates a new session; session-scoped reauth quotas
                    # cannot accidentally carry across an unrelated login.
                    logout(request)
                    login(request, credential.user, backend="django.contrib.auth.backends.ModelBackend")
                    expiry = now + timedelta(
                        seconds=settings.ADMIN_SESSION_COOKIE_AGE if admin else settings.SESSION_COOKIE_AGE
                    )
                    request.session["lab_generation"] = str(credential.generation)
                    request.session["lab_purpose"] = "admin" if admin else "user"
                    request.session["lab_authenticated_at"] = int(now.timestamp())
                    request.session["lab_expires_at"] = int(expiry.timestamp())
                    request.session["lab_admin_reauthenticated_at"] = int(now.timestamp()) if admin else None
                    request.session["lab_browser_id"] = str(browser.id) if browser else None
                    request.session["device_info"] = {"lab_browser_id": str(browser.id)} if browser else {}
                    request.session.set_expiry(expiry)
                    request.session.save()
    security_event(
        request,
        "auth.login",
        username_hash=digest(username),
        purpose="admin" if admin else "user",
        result=result.code if result else "success",
        device_id=str(browser.id) if browser else "",
    )
    if result:
        raise result
    return credential.user


@sensitive_variables()
def reauthenticate_admin(data, request):
    from .middleware import valid_lab_session
    from .security import limit_auth, security_event

    limit_auth(request, trusted=request.user.is_authenticated)
    if not request.user.is_authenticated:
        raise AccessError("请先登录管理后台", 401, code="SESSION_INVALID")
    result = None
    with transaction.atomic():
        credential = (
            Credential.objects.select_for_update(of=("self",))
            .select_related("user")
            .filter(
                user=request.user,
                enabled=True,
                user__is_active=True,
            )
            .first()
        )
        if (
            not valid_lab_session(request, credential, admin=True)
            or not InstanceAdmin.objects.filter(user=request.user).exists()
        ):
            raise AccessError("管理后台认证已失效，请重新登录", 401, code="SESSION_INVALID")
        browser_id = request.session.get("lab_browser_id")
        if (
            browser_id
            and not TrustedBrowser.objects.select_for_update()
            .filter(
                id=browser_id,
                user=request.user,
                purpose="admin",
                generation=credential.generation,
                revoked_at__isnull=True,
            )
            .exists()
        ):
            raise AccessError("可信浏览器已撤销，请重新登录", 401, code="SESSION_INVALID")
        now = timezone.now()
        result = consume_login_quota(credential, now, session_hash=digest(request.session.session_key or ""))
        if not result:
            session = (
                Session.objects.select_for_update()
                .filter(
                    session_key=request.session.session_key,
                    user_id=str(request.user.id),
                    expire_date__gt=now,
                )
                .first()
            )
            step = verified_step(credential.encrypted_secret, data.get("code", ""), credential.last_step)
            if not session or step is None:
                result = AccessError("动态码无效或会话已失效", 401, code="INVALID_CREDENTIALS")
            else:
                credential.last_step = step
                credential.save(update_fields=["last_step"])
                request.session["lab_admin_reauthenticated_at"] = int(now.timestamp())
                request.session.save()
    security_event(
        request,
        "auth.admin_reauthentication",
        result=result.code if result else "success",
        user_id=str(request.user.id),
    )
    if result:
        raise result


def require_lab_session(request):
    """Serialize token writes with SSH recovery; caller owns the transaction."""
    if not settings.LAB_AUTH_ENABLED:
        return
    from rest_framework.exceptions import NotAuthenticated
    from .middleware import admin_path, valid_lab_session

    credential = (
        Credential.objects.select_for_update(of=("self",))
        .filter(user_id=request.user.id, enabled=True, user__is_active=True)
        .first()
    )
    if not valid_lab_session(request, credential, admin_path(request.path)):
        raise NotAuthenticated("认证已失效，请重新登录")
    browser_id = request.session.get("lab_browser_id")
    if (
        browser_id
        and not TrustedBrowser.objects.select_for_update()
        .filter(
            id=browser_id,
            user_id=request.user.id,
            generation=credential.generation,
            revoked_at__isnull=True,
            purpose="admin" if admin_path(request.path) else "user",
        )
        .exists()
    ):
        raise NotAuthenticated("可信浏览器已撤销，请重新登录")


def list_browsers(request, admin=False):
    if not request.user.is_authenticated:
        raise AccessError("请先登录", 401, code="SESSION_INVALID")
    with transaction.atomic():
        require_lab_session(request)
        rows = TrustedBrowser.objects.filter(
            user=request.user,
            purpose="admin" if admin else "user",
            generation=request.session["lab_generation"],
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).order_by("created_at")
        return [
            {
                "id": str(row.id),
                "name": row.name,
                "created_at": row.created_at.isoformat(),
                "expires_at": row.expires_at.isoformat(),
                "last_used_at": row.last_used_at.isoformat(),
                "current": request.session.get("lab_browser_id") == str(row.id),
            }
            for row in rows
        ]


def revoke_browser_sessions(browser, request):
    from django.contrib.auth import logout

    browser.revoked_at = timezone.now()
    browser.save(update_fields=["revoked_at"])
    Session.objects.filter(user_id=str(browser.user_id), device_info__lab_browser_id=str(browser.id)).delete()
    if request.session.get("lab_browser_id") == str(browser.id):
        logout(request)
        request._lab_clear_browser = True


def revoke_browser(request, browser_id, admin=False):
    from .security import security_event

    if not request.user.is_authenticated:
        raise AccessError("请先登录", 401, code="SESSION_INVALID")
    with transaction.atomic():
        require_lab_session(request)
        browser = (
            TrustedBrowser.objects.select_for_update()
            .filter(
                id=browser_id,
                user=request.user,
                purpose="admin" if admin else "user",
                revoked_at__isnull=True,
            )
            .first()
        )
        if not browser:
            raise AccessError("浏览器不存在或已撤销", 404, code="BROWSER_NOT_FOUND")
        revoke_browser_sessions(browser, request)
    security_event(request, "auth.browser_revoked", device_id=str(browser_id), purpose="admin" if admin else "user")


@sensitive_variables()
def forget_browser(request, admin=False):
    from django.contrib.auth import logout
    from .middleware import valid_lab_session
    from .security import limit_auth, security_event

    signed = signed_browser(request, admin=admin)
    limit_auth(request, trusted=bool(signed))
    request._lab_clear_browser = True
    authenticated = request.user.is_authenticated
    user_id = request.user.id if authenticated else signed[0]["user"] if signed else None
    with transaction.atomic():
        credential = (
            Credential.objects.select_for_update().filter(user_id=user_id, enabled=True).first() if user_id else None
        )
        browser = None
        if authenticated and valid_lab_session(request, credential, admin) and request.session.get("lab_browser_id"):
            # The authenticated session owns this device even if its cookie was
            # removed or corrupted. Never revoke a different user's cookie.
            browser = (
                TrustedBrowser.objects.select_for_update()
                .filter(
                    id=request.session["lab_browser_id"],
                    user_id=user_id,
                    purpose="admin" if admin else "user",
                    generation=credential.generation,
                    revoked_at__isnull=True,
                )
                .first()
            )
        if not browser and credential:
            browser = locked_browser(credential, signed, admin)
        if signed and not browser:
            limit_auth(request, trusted=False)
        if browser:
            revoke_browser_sessions(browser, request)
        # Forget also signs out the current purpose when no trust credential was
        # opted in, the cookie is missing, or its signature has become invalid.
        logout(request)
    security_event(request, "auth.browser_forgotten", purpose="admin" if admin else "user")
