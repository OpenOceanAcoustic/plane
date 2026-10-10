# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from .documents import DocumentTasksView, ProjectDocumentsView, TaskDocumentsView
from .document_files import ProjectDocumentDetailView, ProjectDocumentFileView, ProjectDocumentUploadView

document_patterns = [
    path("projects/<uuid:project_id>/documents/", ProjectDocumentsView.as_view()),
    path("projects/<uuid:project_id>/documents/upload/", ProjectDocumentUploadView.as_view()),
    path("projects/<uuid:project_id>/documents/<uuid:page_id>/", ProjectDocumentDetailView.as_view()),
    path(
        "projects/<uuid:project_id>/documents/<uuid:page_id>/versions/<uuid:version_id>/download/",
        ProjectDocumentFileView.as_view(),
    ),
    path(
        "projects/<uuid:project_id>/documents/<uuid:page_id>/versions/<uuid:version_id>/preview/",
        ProjectDocumentFileView.as_view(),
        {"preview": True},
    ),
    path("tasks/<uuid:issue_id>/documents/", TaskDocumentsView.as_view()),
    path("documents/<uuid:page_id>/tasks/", DocumentTasksView.as_view()),
]
