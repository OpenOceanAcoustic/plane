# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from .documents import DocumentTasksView, ProjectDocumentsView, TaskDocumentsView

document_patterns = [
    path("projects/<uuid:project_id>/documents/", ProjectDocumentsView.as_view()),
    path("tasks/<uuid:issue_id>/documents/", TaskDocumentsView.as_view()),
    path("documents/<uuid:page_id>/tasks/", DocumentTasksView.as_view()),
]
