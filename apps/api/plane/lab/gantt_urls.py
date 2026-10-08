# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
from django.urls import path
from .gantt import GanttView, GanttPreviewView, GanttCommitView, GanttDependenciesView

gantt_patterns = [
    path("projects/<uuid:project_id>/gantt/", GanttView.as_view()),
    path("projects/<uuid:project_id>/gantt/preview/", GanttPreviewView.as_view()),
    path("projects/<uuid:project_id>/gantt/commit/", GanttCommitView.as_view()),
    path("projects/<uuid:project_id>/gantt/dependencies/", GanttDependenciesView.as_view()),
]
