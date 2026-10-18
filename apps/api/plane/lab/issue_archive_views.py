# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework.response import Response

from .issue_archiving import archive, preview, restore
from .planning_views import LabView


class TaskArchivePreviewView(LabView):
    def post(self, request, slug):
        return Response(preview(request.user, self.workspace, request.data))


class TaskArchiveView(LabView):
    def post(self, request, slug):
        return Response(archive(request.user, self.workspace, request.data.get("preview_token")))


class TaskRestoreView(LabView):
    def post(self, request, slug, pk):
        return Response(restore(request.user, self.workspace, pk, request.data.get("expected_revision")))
