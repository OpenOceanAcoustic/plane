# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path
from .bounty_views import BountyDetailView, TaskCardMetadataView
from .bounty_materials import BountyMaterialDetailView, BountyMaterialsView

bounty_patterns = [
    path("task-card-metadata/", TaskCardMetadataView.as_view()),
    path("bounties/<uuid:pk>/detail/", BountyDetailView.as_view()),
    path("bounties/<uuid:pk>/materials/", BountyMaterialsView.as_view()),
    path("bounties/<uuid:pk>/materials/<uuid:material_id>/", BountyMaterialDetailView.as_view()),
]
