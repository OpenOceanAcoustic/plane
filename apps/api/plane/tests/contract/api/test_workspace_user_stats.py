# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import datetime, timezone

import pytest

from plane.db.models import Issue, IssueAssignee, IssueSubscriber, Project, ProjectMember, State

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture
def personal_stats(workspace, create_user, session_client):
    create_user.user_timezone = "Asia/Shanghai"
    create_user.save(update_fields=["user_timezone"])
    project = Project.objects.create(workspace=workspace, name="Statistics", identifier="STATS")
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=20)
    state = State.objects.create(workspace=workspace, project=project, name="Completed", group="completed")

    def add_issue(name, completed_at, target_date, priority, issue_project=None):
        issue_project = issue_project or project
        issue_state = state
        if issue_project != project:
            issue_state = State.objects.create(
                workspace=workspace, project=issue_project, name="Completed", group="completed"
            )
        issue = Issue.objects.create(
            workspace=workspace,
            project=issue_project,
            state=issue_state,
            name=name,
            target_date=target_date,
            priority=priority,
            created_by=create_user,
        )
        Issue.objects.filter(pk=issue.pk).update(completed_at=completed_at, created_by=create_user)
        IssueAssignee.objects.create(workspace=workspace, project=issue_project, issue=issue, assignee=create_user)
        IssueSubscriber.objects.create(workspace=workspace, project=issue_project, issue=issue, subscriber=create_user)
        return issue

    recent = add_issue("Recent analysis", datetime(2026, 10, 6, 2, tzinfo=timezone.utc), "2026-10-08", "high")
    older = add_issue("Earlier analysis", datetime(2026, 10, 1, 2, tzinfo=timezone.utc), "2026-10-01", "low")
    return {
        "client": session_client,
        "user": create_user,
        "workspace": workspace,
        "url": f"/api/workspaces/{workspace.slug}/user-stats/{create_user.pk}/",
        "add_issue": add_issue,
        "recent": recent,
        "older": older,
    }


def test_weekly_stats_for_member_without_tasks(workspace, create_user, session_client):
    response = session_client.get(
        f"/api/workspaces/{workspace.slug}/user-stats/{create_user.pk}/",
        {"completed_at": "2026-10-05;after"},
    )
    assert response.status_code == 200, response.data
    assert response.data["completed_issues"] == 0
    assert response.data["subscribed_issues"] == 0


@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("completed_at", "2026-10-05;after", 1),
        ("target_date", "2026-10-08", 1),
        ("priority", "high", 1),
        ("name", "Recent", 1),
        ("assignees", "current-user", 2),
        ("created_by", "current-user", 2),
    ],
)
def test_stats_filter_subscription_by_its_task(personal_stats, field, value, expected):
    if value == "current-user":
        value = str(personal_stats["user"].pk)
    response = personal_stats["client"].get(personal_stats["url"], {field: value})
    assert response.status_code == 200, response.data
    assert response.data["assigned_issues"] == expected
    assert response.data["completed_issues"] == expected
    assert response.data["subscribed_issues"] == expected


def test_unfiltered_stats_still_include_all_own_tasks(personal_stats):
    response = personal_stats["client"].get(personal_stats["url"])
    assert response.status_code == 200, response.data
    for field in ("created_issues", "assigned_issues", "completed_issues", "subscribed_issues"):
        assert response.data[field] == 2


def test_filtered_subscriptions_require_current_project_membership(personal_stats):
    hidden = Project.objects.create(workspace=personal_stats["workspace"], name="Former project", identifier="FORMER")
    ProjectMember.objects.create(
        workspace=personal_stats["workspace"],
        project=hidden,
        member=personal_stats["user"],
        role=20,
        is_active=False,
    )
    personal_stats["add_issue"](
        "Hidden recent task", datetime(2026, 10, 6, 2, tzinfo=timezone.utc), "2026-10-08", "high", hidden
    )
    response = personal_stats["client"].get(personal_stats["url"], {"completed_at": "2026-10-05;after"})
    assert response.status_code == 200, response.data
    assert response.data["completed_issues"] == 1
    assert response.data["subscribed_issues"] == 1


def test_week_boundary_uses_the_users_timezone(personal_stats):
    Issue.objects.filter(pk=personal_stats["recent"].pk).update(
        completed_at=datetime(2026, 10, 4, 16, tzinfo=timezone.utc)
    )
    Issue.objects.filter(pk=personal_stats["older"].pk).update(
        completed_at=datetime(2026, 10, 4, 15, 59, tzinfo=timezone.utc)
    )
    response = personal_stats["client"].get(personal_stats["url"], {"completed_at": "2026-10-05;after"})
    assert response.status_code == 200, response.data
    assert response.data["completed_issues"] == 1
    assert response.data["subscribed_issues"] == 1
