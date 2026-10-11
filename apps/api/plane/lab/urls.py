# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path
from .analytics import AnalyticsDrilldownView, AnalyticsView
from .document_urls import document_patterns
from .field_urls import field_patterns
from .gantt_urls import gantt_patterns
from .workflow_urls import workflow_patterns
from .bounty_urls import bounty_patterns
from .lifecycle_workflow import lifecycle_patterns
from .finance_urls import finance_patterns
from .auth_views import LabAuthView, LabBrowserView, LabInvitationView, LabSignOutView
from .mobile import LiveTicketView
from .contributions import ContributionsCalendarView, ContributionsEntriesView, ContributionsView
from .planning_views import (
    BlockDetailView,
    CalendarView,
    CategoryView,
    CategoryDetailView,
    FlowView,
    FolderDetailView,
    FolderView,
    ItemDetailView,
    ItemView,
    PlannerView,
    PlanningExportView,
    TaskSearchView,
    TaskDeleteView,
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
    path("invitation/", LabInvitationView.as_view()),
    path("enroll/", LabAuthView.as_view(operation="enroll")),
    path("confirm/", LabAuthView.as_view(operation="confirm")),
    path("sign-in/", LabAuthView.as_view(operation="signin")),
    path("mobile/sign-in/", LabAuthView.as_view(operation="mobile")),
    path("admin/sign-in/", LabAuthView.as_view(operation="admin")),
    path("mobile/admin/sign-in/", LabAuthView.as_view(operation="mobile-admin")),
    path("admin/reauthenticate/", LabAuthView.as_view(operation="reauthenticate")),
    path("sign-out/", LabSignOutView.as_view()),
    path("admin/sign-out/", LabSignOutView.as_view()),
    path("browsers/", LabBrowserView.as_view()),
    path("browsers/<uuid:browser_id>/", LabBrowserView.as_view()),
    path("forget-browser/", LabBrowserView.as_view(operation="forget")),
    path("admin/browsers/", LabBrowserView.as_view(admin=True)),
    path("admin/browsers/<uuid:browser_id>/", LabBrowserView.as_view(admin=True)),
    path("admin/forget-browser/", LabBrowserView.as_view(admin=True, operation="forget")),
]

business_patterns = [
    path("live-ticket/", LiveTicketView.as_view()),
    path("me/contributions/", ContributionsView.as_view()),
    path("me/contributions/calendar/", ContributionsCalendarView.as_view()),
    path("me/contributions/entries/", ContributionsEntriesView.as_view()),
    path("analytics/", AnalyticsView.as_view()),
    path("analytics/drilldown/", AnalyticsDrilldownView.as_view()),
    *workflow_patterns,
    *bounty_patterns,
    *lifecycle_patterns,
    *finance_patterns,
    *document_patterns,
    *field_patterns,
    *gantt_patterns,
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
    path("categories/", CategoryView.as_view()),
    path("categories/<uuid:pk>/", CategoryDetailView.as_view()),
    path("items/", ItemView.as_view()),
    path("items/<uuid:pk>/", ItemDetailView.as_view()),
    path("tasks/", TaskSearchView.as_view()),
    path("tasks/<uuid:pk>/", TaskDeleteView.as_view()),
    path("flows/<uuid:pk>/", FlowView.as_view()),
    path("calendar/", CalendarView.as_view()),
    path("calendar/<uuid:pk>/", BlockDetailView.as_view()),
]
