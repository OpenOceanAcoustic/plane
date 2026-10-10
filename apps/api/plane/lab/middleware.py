# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.contrib.auth import logout
from django.http import JsonResponse

from .models import Credential


def admin_path(path):
    return path.startswith("/api/instances/") or path in (
        "/auth/lab/admin/sign-in/", "/auth/lab/mobile/admin/sign-in/",
    )


class LabAccessMiddleware:
    """Gate legacy identities and all legacy authentication routes server-side."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if settings.LAB_AUTH_ENABLED:
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
                if not credential or request.session.get("lab_generation") != str(credential.generation):
                    logout(request)
                    return JsonResponse({"error": "认证已失效，请重新绑定或登录"}, status=401)
        if request.session.get("lab_client") == "android" and path.startswith("/api/"):
            from .mobile import is_export_request

            if is_export_request(request):
                return JsonResponse(
                    {"error": "手机端不支持数据导出", "code": "mobile_export_disabled"}, status=403
                )
        return self.get_response(request)
