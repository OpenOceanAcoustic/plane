# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python import
from uuid import uuid4
from typing import Optional
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

# Third party
from rest_framework.response import Response
from rest_framework.request import Request
from rest_framework import status
from rest_framework import serializers

# Module import
from .base import BaseAPIView
from plane.db.models import APIToken, User
from plane.app.serializers import APITokenSerializer, APITokenReadSerializer
from plane.lab.auth import require_lab_session


class ApiTokenEndpoint(BaseAPIView):
    @transaction.atomic
    def post(self, request: Request) -> Response:
        require_lab_session(request)
        # Credential/device locks (when enabled) precede the user lock used by all
        # token-creation requests, keeping recovery and quota enforcement atomic.
        User.objects.select_for_update().only("id").get(id=request.user.id)
        if (
            settings.LAB_AUTH_ENABLED
            and APIToken.objects.filter(
                Q(expired_at__isnull=True) | Q(expired_at__gt=timezone.now()),
                user=request.user,
                is_active=True,
            ).count()
            >= settings.LAB_API_TOKEN_LIMIT
        ):
            return Response(
                {"error": "有效 API 密钥已达上限", "code": "API_TOKEN_LIMIT_REACHED"}, status=status.HTTP_409_CONFLICT
            )
        label = request.data.get("label", str(uuid4().hex))
        description = request.data.get("description", "")
        expired_at = request.data.get("expired_at", None)
        if settings.LAB_AUTH_ENABLED:
            now = timezone.now()
            if expired_at is None:
                expired_at = now + timedelta(days=settings.LAB_API_TOKEN_DAYS)
            else:
                try:
                    expired_at = serializers.DateTimeField().run_validation(expired_at)
                except serializers.ValidationError:
                    return Response(
                        {"error": "请填写有效 API 密钥到期时间", "code": "INVALID_TOKEN_EXPIRY"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            if not now < expired_at <= now + timedelta(days=settings.LAB_API_TOKEN_MAX_DAYS):
                return Response(
                    {"error": "API 密钥到期时间须在未来 90 天内", "code": "INVALID_TOKEN_EXPIRY"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Check the user type
        user_type = 1 if request.user.is_bot else 0

        api_token = APIToken.objects.create(
            label=label,
            description=description,
            user=request.user,
            user_type=user_type,
            expired_at=expired_at,
        )

        serializer = APITokenSerializer(api_token)
        # Token will be only visible while creating
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def get(self, request: Request, pk: Optional[str] = None) -> Response:
        if pk is None:
            api_tokens = APIToken.objects.filter(user=request.user, is_service=False)
            serializer = APITokenReadSerializer(api_tokens, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            api_tokens = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
            serializer = APITokenReadSerializer(api_tokens)
            return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, pk: str) -> Response:
        api_token = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
        api_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @transaction.atomic
    def patch(self, request: Request, pk: str) -> Response:
        require_lab_session(request)
        api_token = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
        serializer = APITokenSerializer(api_token, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
