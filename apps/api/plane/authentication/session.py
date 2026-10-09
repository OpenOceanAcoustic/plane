# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied


class BaseSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            from plane.lab.security import enforce_user_limits

            enforce_user_limits(request, user=result[0])
        return result

    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request)
        except PermissionDenied:
            # The clients retry only this explicit code, never an ordinary 403.
            raise PermissionDenied({"code": "CSRF_FAILED", "error": "请求校验失败，请重试"}) from None
