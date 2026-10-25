# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path
from .agent_drafts import AgentMessageConfirmView
from .analytics import AnalyticsDrilldownView, AnalyticsView
from .document_urls import document_patterns
from .field_urls import field_patterns
from .gantt_urls import gantt_patterns
from .workflow_urls import workflow_patterns
from .bounty_urls import bounty_patterns
from .agent_views import AgentBriefView, AgentReminderView, AgentRetroView, AgentQualityView, AgentTeamView, AgentKnowledgeView, AgentFinanceView, AgentMeetingView, AgentProposalView, AgentProposalApproveView, AgentHealthView, AgentMessageAppendView, AgentLeadRequestView, AgentLeadReviewView, AgentActionExecuteView, AgentChatView, AgentProjectIssueView, AgentProjectPlanView, AgentThreadDetailView, AgentThreadsView, AgentToolUsageView, TimeAgentHealthView, TimeAgentView
from .cash_bounties import CashBountyActionView, CashBountyDetailView, CashBountyView
from .lifecycle_workflow import lifecycle_patterns
from .finance_urls import finance_patterns
from .project_management import ProjectFinanceManagementView
from .project_labor import ProjectLaborTeamsView
from .project_quality import ProjectQualityView
from .chat_urls import chat_patterns
from .invitation_views import LabInvitationCreateView
from .auth_views import LabAuthView, LabBrowserView, LabInvitationView, LabSignOutView
from .mobile import LiveTicketView
from .contributions import ContributionsCalendarView, ContributionsEntriesView, ContributionsView
from .workload import WorkloadView
from .next_actions import MeNextActionsView
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
    path("invitations/", LabInvitationCreateView.as_view()),
    path("projects/<uuid:pk>/finance-management/", ProjectFinanceManagementView.as_view()),
    path("projects/<uuid:pk>/labor-teams/", ProjectLaborTeamsView.as_view()),
    path("projects/<uuid:pk>/quality/", ProjectQualityView.as_view()),
    *chat_patterns,
    path("live-ticket/", LiveTicketView.as_view()),
    path("me/contributions/", ContributionsView.as_view()),
    path("me/workload/", WorkloadView.as_view()),
    path("me/next-actions/", MeNextActionsView.as_view()),
    path("me/contributions/calendar/", ContributionsCalendarView.as_view()),
    path("me/contributions/entries/", ContributionsEntriesView.as_view()),
    path("analytics/", AnalyticsView.as_view()),
    path("analytics/drilldown/", AnalyticsDrilldownView.as_view()),
    *workflow_patterns,
    path("agent/time/health/", TimeAgentHealthView.as_view()),
    path("agent/health/", AgentHealthView.as_view()),
    path("agent/brief/", AgentBriefView.as_view()),
    path("agent/reminders/", AgentReminderView.as_view()),
    path("agent/retro/", AgentRetroView.as_view()),
    path("agent/quality/", AgentQualityView.as_view()),
    path("agent/team/", AgentTeamView.as_view()),
    path("agent/knowledge/", AgentKnowledgeView.as_view()),
    path("agent/finance/", AgentFinanceView.as_view()),
    path("agent/meeting/", AgentMeetingView.as_view()),
    path("agent/proposals/", AgentProposalView.as_view()),
    path("agent/proposals/<uuid:pk>/approve/", AgentProposalApproveView.as_view()),
    path("agent/lead-requests/", AgentLeadRequestView.as_view()),
    path("agent/lead-requests/<uuid:pk>/review/", AgentLeadReviewView.as_view()),
    path("agent/actions/<uuid:pk>/execute/", AgentActionExecuteView.as_view()),
    path("agent/messages/", AgentMessageAppendView.as_view()),
    path("agent/messages/<uuid:pk>/confirm/", AgentMessageConfirmView.as_view()),
    path("agent/chat/", AgentChatView.as_view()),
    path("agent/project-issue/", AgentProjectIssueView.as_view()),
    path("agent/project-plan/", AgentProjectPlanView.as_view()),
    path("agent/threads/", AgentThreadsView.as_view()),
    path("agent/tool-usage/", AgentToolUsageView.as_view()),
    path("agent/threads/<uuid:pk>/", AgentThreadDetailView.as_view()),
    path("agent/time/", TimeAgentView.as_view()),
    path("cash-bounties/", CashBountyView.as_view()),
    path("cash-bounties/<uuid:pk>/", CashBountyDetailView.as_view()),
    path("cash-bounties/<uuid:pk>/<str:action>/", CashBountyActionView.as_view()),
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
