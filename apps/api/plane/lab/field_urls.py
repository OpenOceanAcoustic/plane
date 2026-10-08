# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
from django.urls import path
from .fields import FieldDefinitionsView, FieldDefinitionView, ProjectFieldsView, IssueFieldsView, TaskTableView

field_patterns = [
    path("field-definitions/", FieldDefinitionsView.as_view()),
    path("field-definitions/<uuid:pk>/", FieldDefinitionView.as_view()),
    path("projects/<uuid:project_id>/fields/", ProjectFieldsView.as_view()),
    path("tasks/<uuid:issue_id>/field-values/", IssueFieldsView.as_view()),
    path("task-table/", TaskTableView.as_view()),
]
