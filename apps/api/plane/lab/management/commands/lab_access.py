# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from plane.db.models import User, Workspace
from plane.lab.auth import AccessError, audit, issue_invitation
from plane.lab.models import Credential, Invitation


class Command(BaseCommand):
    help = "SSH-only laboratory bootstrap, invite, revoke and Authenticator reset. Never expose as a web endpoint."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["bootstrap", "invite", "revoke", "reset", "list", "purge"])
        parser.add_argument("--workspace", default="openoceanacoustic")
        parser.add_argument("--username")
        parser.add_argument("--id")
        parser.add_argument("--role", type=int, choices=[5, 15, 20], default=15)

    def handle(self, *args, **options):
        try:
            action = options["action"]
            if action == "list":
                for row in Invitation.objects.order_by("-created_at")[:100]:
                    status = "used" if row.consumed_at else "revoked" if row.revoked_at else "pending"
                    self.stdout.write(
                        f"{row.id} {row.kind} {row.workspace_slug or row.workspace_id} "
                        f"{row.expires_at.isoformat()} {status}"
                    )
                return
            if action == "revoke":
                with transaction.atomic():
                    invitation = Invitation.objects.select_for_update().get(id=options["id"])
                    invitation.revoked_at = timezone.now()
                    invitation.save(update_fields=["revoked_at"])
                    audit("auth.revoked", invitation)
                self.stdout.write("邀请已撤销")
                return
            if action == "purge":
                from datetime import timedelta
                from plane.lab.models import Enrollment, LoginAttempt, TrustedBrowser

                Enrollment.objects.filter(invitation__expires_at__lte=timezone.now()).delete()
                LoginAttempt.objects.filter(submitted_at__lte=timezone.now() - timedelta(seconds=600)).delete()
                # Keep browser history but mark expired credentials unusable explicitly.
                TrustedBrowser.objects.filter(expires_at__lte=timezone.now(), revoked_at__isnull=True).update(
                    revoked_at=timezone.now()
                )
                # Keep identity rows: deleting one concurrently with a login
                # could cascade-delete a newly committed quota submission.
                self.stdout.write("过期绑定和限流记录已清理；邀请和审计记录保留")
                return
            if action == "bootstrap":
                invitation, token = issue_invitation("bootstrap", workspace_slug=options["workspace"], role=20)
            elif action == "invite":
                workspace = Workspace.objects.get(slug=options["workspace"])
                invitation, token = issue_invitation("member", workspace=workspace, role=options["role"])
            else:
                user = User.objects.get(username__iexact=options["username"])
                invitation, token = issue_invitation("rebind", user=user)
            self.stdout.write(f"ID: {invitation.id}\nExpires: {invitation.expires_at.isoformat()}")
            # The proxy validates this capability before serving the registration page.
            self.stdout.write(f"{settings.WEB_URL.rstrip('/')}/lab/register/{token}")
        except (
            AccessError,
            ValidationError,
            ValueError,
            User.DoesNotExist,
            Workspace.DoesNotExist,
            Invitation.DoesNotExist,
            Credential.DoesNotExist,
        ) as error:
            raise CommandError(getattr(error, "message", "请求无效，请检查工作区、用户名或邀请 ID"))
