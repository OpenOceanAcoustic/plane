# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path
from .bounty_views import BountyBudgetView, BountyDetailView, TaskCardMetadataView
from .bounty_materials import BountyMaterialDetailView, BountyMaterialFileView, BountyMaterialsView
from .quote_views import BountyQuoteDecisionView, BountyQuotesView
from .quote_files import BountyQuoteDownloadView, BountyQuoteUploadView
from .vc_views import VCBudgetEntryView, VCQuotaView

bounty_patterns = [
    path("bounties/budgets/<uuid:project_id>/entries/<uuid:entry_id>/", VCBudgetEntryView.as_view()),
    path("bounties/quotas/<uuid:project_id>/", VCQuotaView.as_view()),
    path("bounties/<uuid:pk>/quote-attachments/", BountyQuoteUploadView.as_view()),
    path("bounties/<uuid:pk>/quote-attachments/<uuid:attachment_id>/", BountyQuoteDownloadView.as_view()),
    path("bounties/<uuid:pk>/quotes/", BountyQuotesView.as_view()),
    path("bounties/<uuid:pk>/quotes/<uuid:quote_id>/<str:action>/", BountyQuoteDecisionView.as_view()),
    path("task-card-metadata/", TaskCardMetadataView.as_view()),
    path("bounties/budgets/", BountyBudgetView.as_view()),
    path("bounties/<uuid:pk>/detail/", BountyDetailView.as_view()),
    path("bounties/<uuid:pk>/materials/", BountyMaterialsView.as_view()),
    path("bounties/<uuid:pk>/materials/<uuid:material_id>/", BountyMaterialDetailView.as_view()),
    path("bounties/<uuid:pk>/materials/<uuid:material_id>/download/", BountyMaterialFileView.as_view()),
    path(
        "bounties/<uuid:pk>/materials/<uuid:material_id>/preview/",
        BountyMaterialFileView.as_view(),
        {"preview": True},
    ),
]
