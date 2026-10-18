# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Read-only personal workload advice; it never authorizes or rejects task mutations."""

from django.db import connection
from django.db.models import Max
from django.utils import timezone
from rest_framework.response import Response

from .models import WIPException
from .planning_views import LabView


def workload(user, workspace):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(DISTINCT task), count(DISTINCT task) FILTER (WHERE major) "
            "FROM lab_work() WHERE workspace=%s AND person=%s",
            [workspace.id, user.id],
        )
        active, major = cursor.fetchone()
    limits = WIPException.objects.filter(workspace=workspace, user=user, expires_at__gt=timezone.now()).aggregate(
        active=Max("active_limit"), major=Max("major_limit")
    )
    active_limit, major_limit = limits["active"] or 2, limits["major"] or 1
    overloaded = active > active_limit or major > major_limit
    return {
        "active": active,
        "major": major,
        "active_limit": active_limit,
        "major_limit": major_limit,
        "overloaded": overloaded,
        "blocking": False,
        "message": (
            f"并行提醒：当前进行中 {active} 项（建议 {active_limit} 项），"
            f"其中重大 {major} 项（建议 {major_limit} 项）。"
        )
        if overloaded
        else "",
    }


class WorkloadView(LabView):
    def get(self, request, slug):
        return Response(workload(request.user, self.workspace))
