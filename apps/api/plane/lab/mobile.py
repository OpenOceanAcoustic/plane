# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Session capabilities and single-use mobile collaboration credentials."""

import hashlib
import json
import secrets
from functools import wraps

from django.conf import settings
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from redis.exceptions import RedisError
from rest_framework.exceptions import NotAuthenticated, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.license.models import InstanceAdmin
from plane.settings.redis import redis_instance
from .auth import require_lab_session
from .documents import page_access
from .planning_views import LabView

MOBILE_API_VERSION = 1
TICKET_TTL = 60


def session_capabilities(request):
    platform = "android" if request.session.get("lab_client") == "android" else "web"
    return {"client_platform": platform, "capabilities": {"data_export": platform != "android"}}


def is_export_request(request):
    # Dedicated endpoints include issue export and its export history (GET).
    segments = request.path.strip("/").split("/")
    dedicated = any(
        (part == "export" or part.startswith("export-") or part.endswith("-export"))
        for index, part in enumerate(segments)
        if index == 0 or segments[index - 1] != "workspaces"
    )
    export_format = request.GET.get("format", "").casefold() in ("csv", "pdf", "xlsx", "xls", "png", "svg")
    return dedicated or export_format


def instance_mobile_version(view):
    """Attach capabilities outside the instance cache, including cached pre-upgrade data."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        response = view(*args, **kwargs)
        if response.status_code == 200:
            response.data = {**response.data, "mobile_api_version": MOBILE_API_VERSION}
        return response
    return wrapped


@method_decorator(never_cache, name="dispatch")
class MobileSessionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.query_params.get("admin") == "true" and not InstanceAdmin.objects.filter(user=request.user).exists():
            raise NotAuthenticated("管理员会话已失效")
        user = request.user
        return Response({
            "user": {"id": str(user.id), "username": user.username, "display_name": user.display_name, "email": user.email},
            **session_capabilities(request),
            "mobile_api_version": MOBILE_API_VERSION,
        })


def ticket_key(token):
    return "hocuspocus:mobile-ticket:" + hashlib.sha256(token.encode()).hexdigest()


@method_decorator(never_cache, name="dispatch")
class LiveTicketView(LabView):
    @transaction.atomic
    def post(self, request, slug):
        require_lab_session(request)
        project_id = request.data.get("project_id")
        page_id = request.data.get("page_id")
        if not project_id or not page_id:
            raise ValidationError("需要项目与文档 ID")
        page, membership = page_access(request.user, self.workspace, project_id, page_id)
        if not request.session.session_key:
            raise NotAuthenticated("需要有效会话")
        token = secrets.token_urlsafe(32)
        payload = {
            "user_id": str(request.user.id),
            "page_id": str(page.id),
            "project_id": str(membership.project_id),
            "workspace_slug": slug,
            "document_type": "project_page",
            "cookie": settings.SESSION_COOKIE_NAME + "=" + request.session.session_key,
            "read_only": membership.role < 15 or page.is_locked or bool(page.archived_at),
        }
        try:
            redis_instance().set(ticket_key(token), json.dumps(payload), ex=TICKET_TTL, nx=True)
        except RedisError:
            return Response({"error": "协作服务暂不可用"}, status=503)
        return Response({
            "ticket": token, "expires_in": TICKET_TTL,
            "document_name": str(page.id), "document_type": "project_page",
            "read_only": payload["read_only"],
        }, status=201)
