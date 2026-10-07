# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path
from .auth_views import LabAuthView
from .planning_views import (
    BlockDetailView,
    CalendarView,
    FlowView,
    FolderDetailView,
    FolderView,
    ItemDetailView,
    ItemView,
    PlannerView,
    PlanningExportView,
    TaskSearchView,
)
from .bounty_views import (
    BountyActionView,
    BountyView,
    InboxView,
    LedgerReverseView,
    LedgerView,
    StageView,
    WIPExceptionView,
)

auth_patterns = [
    path("enroll/", LabAuthView.as_view(operation="enroll")),
    path("confirm/", LabAuthView.as_view(operation="confirm")),
    path("sign-in/", LabAuthView.as_view(operation="signin")),
    path("admin/sign-in/", LabAuthView.as_view(operation="admin")),
]

business_patterns = [
    path("stages/", StageView.as_view()),
    path("bounties/", BountyView.as_view()),
    path("bounties/<uuid:pk>/<str:action>/", BountyActionView.as_view()),
    path("ledger/", LedgerView.as_view()),
    path("ledger/<uuid:pk>/reverse/", LedgerReverseView.as_view()),
    path("wip-exceptions/", WIPExceptionView.as_view()),
    path("inbox/", InboxView.as_view()),
    path("planner/", PlannerView.as_view()),
    path("planning-export/", PlanningExportView.as_view()),
    path("folders/", FolderView.as_view()),
    path("folders/<uuid:pk>/", FolderDetailView.as_view()),
    path("items/", ItemView.as_view()),
    path("items/<uuid:pk>/", ItemDetailView.as_view()),
    path("tasks/", TaskSearchView.as_view()),
    path("flows/<uuid:pk>/", FlowView.as_view()),
    path("calendar/", CalendarView.as_view()),
    path("calendar/<uuid:pk>/", BlockDetailView.as_view()),
]
