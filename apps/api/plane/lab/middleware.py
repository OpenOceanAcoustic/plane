# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.contrib.auth import logout
from django.http import JsonResponse
from django.utils import timezone

from .models import Credential, TrustedBrowser


def admin_path(path):
    return (
        path.rstrip("/") == "/api/instances"
        or path.startswith("/api/instances/")
        or path.startswith("/auth/lab/admin/")
        or path.startswith("/auth/lab/mobile/admin/")
    )


def is_admin_request(request):
    return admin_path(request.path) or (
        request.path.rstrip("/") == "/api/lab/session" and request.GET.get("admin") == "true"
    )


def valid_lab_session(request, credential, admin=False):
    expiry = request.session.get("lab_expires_at")
    return bool(
        credential
        and request.session.get("lab_generation") == str(credential.generation)
        and request.session.get("lab_purpose") == ("admin" if admin else "user")
        and isinstance(expiry, (int, float))
        and expiry > timezone.now().timestamp()
    )


class LabAccessMiddleware:
    """Gate legacy identities and all legacy authentication routes server-side."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.LAB_AUTH_ENABLED:
            path = request.path
            allowed_auth = path.startswith("/auth/lab/") or path in (
                "/auth/get-csrf-token/",
                "/auth/sign-out/",
                "/auth/spaces/sign-out/",
            )
            blocked = (path.startswith("/auth/") and not allowed_auth) or path.rstrip("/") in (
                "/api/instances/admins/sign-in",
                "/api/instances/admins/sign-up",
                "/api/instances/admins/sign-up-screen-visited",
            )
            blocked |= path.rstrip("/") == "/api/instances/admins" and request.method == "POST"
            if blocked:
                return JsonResponse({"error": "仅支持 SSH 邀请注册和 Authenticator 动态码登录"}, status=403)
            public_instance = path.rstrip("/") == "/api/instances" and request.method in ("GET", "HEAD", "OPTIONS")
            token_api = path.startswith("/api/v1/") and bool(request.headers.get("X-Api-Key"))
            if (
                path.startswith("/api/")
                and not public_instance
                and not token_api
                and request.method != "OPTIONS"
                and not request.user.is_authenticated
            ):
                return JsonResponse({"error": "请使用 Authenticator 登录"}, status=401)
            if request.user.is_authenticated:
                credential = Credential.objects.filter(user=request.user, enabled=True, user__is_active=True).first()
                is_admin = is_admin_request(request)
                if not valid_lab_session(request, credential, is_admin):
                    logout(request)
                    return JsonResponse(
                        {"error": "认证已失效，请重新绑定或登录", "code": "SESSION_INVALID"}, status=401
                    )
                browser_id = request.session.get("lab_browser_id")
                if (
                    browser_id
                    and not TrustedBrowser.objects.filter(
                        id=browser_id,
                        user=request.user,
                        purpose="admin" if is_admin else "user",
                        generation=credential.generation,
                        revoked_at__isnull=True,
                    ).exists()
                ):
                    logout(request)
                    return JsonResponse(
                        {"error": "可信浏览器已撤销，请重新登录", "code": "SESSION_INVALID"}, status=401
                    )
                exempt = {
                    "/auth/lab/admin/sign-in/",
                    "/auth/lab/mobile/admin/sign-in/",
                    "/auth/lab/admin/reauthenticate/",
                    "/auth/lab/admin/sign-out/",
                    "/auth/lab/admin/forget-browser/",
                    "/api/instances/admins/sign-out/",
                }
                fresh = request.session.get("lab_admin_reauthenticated_at")
                if (
                    is_admin
                    and request.method not in ("GET", "HEAD", "OPTIONS")
                    and path not in exempt
                    and (
                        not isinstance(fresh, (int, float))
                        or timezone.now().timestamp() - fresh >= settings.LAB_ADMIN_REAUTH_AGE
                    )
                ):
                    return JsonResponse({"error": "请重新验证动态码", "code": "ADMIN_REAUTH_REQUIRED"}, status=403)
        if request.session.get("lab_client") == "android" and request.path.startswith("/api/"):
            from .mobile import is_export_request

            if is_export_request(request):
                return JsonResponse(
                    {"error": "手机端不支持数据导出", "code": "mobile_export_disabled"}, status=403
                )
        return self.get_response(request)
