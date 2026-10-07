# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json

from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.cache import never_cache

from .auth import AccessError, authenticate, begin_enrollment, confirm_enrollment


@method_decorator([csrf_protect, never_cache, sensitive_post_parameters()], name="dispatch")
class LabAuthView(View):
    operation = ""

    @sensitive_variables()
    def post(self, request):
        try:
            data = json.loads(request.body)
            if not isinstance(data, dict):
                raise ValueError()
            if self.operation == "enroll":
                result, status = begin_enrollment(data), 200
            elif self.operation == "confirm":
                user = confirm_enrollment(data)
                result, status = {"username": user.username, "message": "绑定成功，请等待下一动态码登录"}, 201
            else:
                user = authenticate(data, request, admin=self.operation == "admin")
                result, status = {"username": user.username}, 200
            return JsonResponse(result, status=status)
        except AccessError as error:
            response = JsonResponse({"error": error.message, "retry_after": error.retry_after}, status=error.status)
            if error.retry_after:
                response["Retry-After"] = str(error.retry_after)
            return response
        except (ValueError, TypeError):
            return JsonResponse({"error": "请求格式无效"}, status=400)
