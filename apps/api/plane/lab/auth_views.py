# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json

from django.http import JsonResponse
from django.contrib.auth import logout
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.cache import never_cache

from .auth import (
    AccessError,
    authenticate,
    begin_enrollment,
    browser_cookie_response,
    confirm_enrollment,
    forget_browser,
    list_browsers,
    reauthenticate_admin,
    revoke_browser,
)


@method_decorator([csrf_protect, never_cache, sensitive_post_parameters()], name="dispatch")
class LabAuthView(View):
    operation = ""

    @sensitive_variables()
    def post(self, request):
        from .security import limit_auth, security_event

        try:
            if len(request.body) > 8192:
                limit_auth(request)
                raise AccessError("认证请求过大", 413, code="REQUEST_TOO_LARGE")
            try:
                data = json.loads(request.body)
            except (ValueError, TypeError):
                limit_auth(request)
                raise AccessError("请求格式无效", 400, code="INVALID_REQUEST") from None
            if not isinstance(data, dict):
                limit_auth(request)
                raise AccessError("请求格式无效", 400, code="INVALID_REQUEST")
            if self.operation == "enroll":
                limit_auth(request)
                result, status = begin_enrollment(data), 200
            elif self.operation == "confirm":
                limit_auth(request)
                user = confirm_enrollment(data)
                result, status = {"username": user.username, "message": "绑定成功，请等待下一动态码登录"}, 201
            elif self.operation == "reauthenticate":
                reauthenticate_admin(data, request)
                result, status = {"message": "验证成功", "expires_at": request.session["lab_expires_at"]}, 200
            else:
                user = authenticate(data, request, admin=self.operation == "admin")
                result, status = (
                    {
                        "username": user.username,
                        "remembered_browser": bool(request.session.get("lab_browser_id")),
                        "browser_limit_reached": getattr(request, "_lab_browser_limit_reached", False),
                    },
                    200,
                )
            if self.operation in ("enroll", "confirm"):
                security_event(request, "auth.enrollment", purpose=self.operation, result="success")
            return browser_cookie_response(request, JsonResponse(result, status=status), self.operation == "admin")
        except AccessError as error:
            if error.code in ("RATE_LIMITED", "AUTH_UNAVAILABLE", "INVALID_REQUEST", "REQUEST_TOO_LARGE"):
                security_event(request, "auth.denied", reason=error.code, result="denied")
            if self.operation in ("enroll", "confirm"):
                security_event(request, "auth.enrollment", purpose=self.operation, result=error.code)
            response = JsonResponse(
                {"error": error.message, "code": error.code, "retry_after": error.retry_after}, status=error.status
            )
            if error.retry_after:
                response["Retry-After"] = str(error.retry_after)
            return browser_cookie_response(request, response, self.operation == "admin")
        except (ValueError, TypeError):
            return JsonResponse({"error": "请求格式无效", "code": "INVALID_REQUEST"}, status=400)


@method_decorator([csrf_protect, never_cache], name="dispatch")
class LabBrowserView(View):
    admin = False
    operation = "list"

    def dispatch(self, request, *args, **kwargs):
        from rest_framework.exceptions import NotAuthenticated

        try:
            return super().dispatch(request, *args, **kwargs)
        except AccessError as error:
            response = JsonResponse(
                {"error": error.message, "code": error.code, "retry_after": error.retry_after}, status=error.status
            )
            if error.retry_after:
                response["Retry-After"] = str(error.retry_after)
            return browser_cookie_response(request, response, self.admin)
        except NotAuthenticated:
            return JsonResponse({"error": "认证已失效，请重新登录", "code": "SESSION_INVALID"}, status=401)

    def get(self, request):
        if self.operation != "list":
            return self.http_method_not_allowed(request)
        return JsonResponse({"browsers": list_browsers(request, self.admin)})

    def delete(self, request, browser_id):
        revoke_browser(request, browser_id, self.admin)
        return browser_cookie_response(request, JsonResponse({"message": "浏览器已撤销"}), self.admin)

    def post(self, request):
        if self.operation != "forget":
            return self.http_method_not_allowed(request)
        forget_browser(request, self.admin)
        return browser_cookie_response(request, JsonResponse({"message": "已忘记此浏览器"}), self.admin)


@method_decorator([csrf_protect, never_cache], name="dispatch")
class LabSignOutView(View):
    def post(self, request):
        from .security import security_event

        security_event(request, "auth.signout")
        logout(request)
        return JsonResponse({"message": "已退出登录"})
