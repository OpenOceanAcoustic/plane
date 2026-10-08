# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import date
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from django.db import close_old_connections
from plane.db.models import Issue, IssueActivity, IssueRelation, Project, ProjectMember

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def task(lab, name, start, end):
    return Issue.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        name=name,
        start_date=date.fromisoformat(start),
        target_date=date.fromisoformat(end),
    )


def dependency(lab, predecessor, successor):
    return IssueRelation.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        issue=successor,
        related_issue=predecessor,
        relation_type="blocked_by",
    )


def gantt_url(lab, action=""):
    return lab["base"] + f"projects/{lab['project'].id}/gantt/" + action


def preview(lab, issue, start, end):
    return lab["client"](lab["member"]).post(
        gantt_url(lab, "preview/"), {"issue_id": str(issue.id), "start_date": start, "target_date": end}, format="json"
    )


def test_preview_cascades_only_violations_and_commit_is_atomic_and_audited(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    b = task(lab, "B", "2026-10-03", "2026-10-05")
    c = task(lab, "C", "2026-10-20", "2026-10-21")
    dependency(lab, a, b)
    dependency(lab, b, c)
    response = preview(lab, a, "2026-10-05", "2026-10-06")
    assert response.status_code == 200, response.content
    changes = {row["id"]: row for row in response.json()["changes"]}
    assert set(changes) == {str(a.id), str(b.id)}
    assert changes[str(b.id)]["start_date"] == "2026-10-07"
    assert changes[str(b.id)]["target_date"] == "2026-10-09"
    a.refresh_from_db()
    assert a.target_date == date(2026, 10, 2)
    body = {"token": response.json()["token"]}
    client = lab["client"](lab["member"])
    committed = client.post(gantt_url(lab, "commit/"), body, format="json")
    assert committed.status_code == 200, committed.content
    b.refresh_from_db()
    assert b.start_date == date(2026, 10, 7)
    assert IssueActivity.objects.filter(issue=b, field="start_date").exists()
    assert client.post(gantt_url(lab, "commit/"), body, format="json").status_code == 409


def test_preview_stale_when_native_task_or_relation_changes(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    response = preview(lab, a, "2026-10-03", "2026-10-04")
    assert response.status_code == 200
    Issue.objects.filter(id=a.id).update(target_date=date(2026, 10, 8))
    committed = lab["client"](lab["member"]).post(
        gantt_url(lab, "commit/"), {"token": response.json()["token"]}, format="json"
    )
    assert committed.status_code == 409
    a.refresh_from_db()
    assert a.target_date == date(2026, 10, 8)


def test_dependency_creation_rejects_cycles_self_and_cross_project(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    b = task(lab, "B", "2026-10-03", "2026-10-04")
    client = lab["client"](lab["member"])
    body = {"predecessor_id": str(a.id), "successor_id": str(b.id)}
    assert client.post(gantt_url(lab, "dependencies/"), body, format="json").status_code == 201
    assert (
        client.post(
            gantt_url(lab, "dependencies/"), {"predecessor_id": str(b.id), "successor_id": str(a.id)}, format="json"
        ).status_code
        == 400
    )
    foreign = Project.objects.create(workspace=lab["workspace"], name="Other", identifier="OTHER")
    ProjectMember.objects.create(workspace=lab["workspace"], project=foreign, member=lab["member"], role=15)
    other = Issue.objects.create(workspace=lab["workspace"], project=foreign, name="Other task")
    assert (
        client.post(
            gantt_url(lab, "dependencies/"), {"predecessor_id": str(a.id), "successor_id": str(other.id)}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.post(
            gantt_url(lab, "dependencies/"), {"predecessor_id": str(a.id), "successor_id": str(a.id)}, format="json"
        ).status_code
        == 400
    )


def test_undated_and_external_dependencies_fail_without_metadata_leak(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    b = Issue.objects.create(workspace=lab["workspace"], project=lab["project"], name="未排期")
    dependency(lab, a, b)
    assert preview(lab, a, "2026-10-03", "2026-10-04").status_code == 400
    b.delete()
    foreign = Project.objects.create(workspace=lab["workspace"], name="机密项目", identifier="SECRET")
    secret = Issue.objects.create(
        workspace=lab["workspace"],
        project=foreign,
        name="机密标题",
        start_date=date(2026, 10, 1),
        target_date=date(2026, 10, 2),
    )
    IssueRelation.objects.create(
        workspace=lab["workspace"], project=lab["project"], issue=a, related_issue=secret, relation_type="blocked_by"
    )
    response = preview(lab, a, "2026-10-03", "2026-10-04")
    assert response.status_code in (400, 403)
    assert "机密" not in response.content.decode()


def test_archived_and_restricted_guest_cannot_edit_or_preview_hidden_tasks(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    Issue.objects.filter(id=a.id).update(archived_at=date(2026, 10, 8))
    assert preview(lab, a, "2026-10-03", "2026-10-04").status_code == 404
    Issue.objects.filter(id=a.id).update(archived_at=None)
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    assert preview(lab, a, "2026-10-03", "2026-10-04").status_code == 404


def test_concurrent_confirmation_has_one_winner(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    response = preview(lab, a, "2026-10-05", "2026-10-06")
    assert response.status_code == 200
    barrier = Barrier(2)

    def confirm():
        close_old_connections()
        try:
            client = lab["client"](lab["member"])
            barrier.wait(timeout=10)
            return client.post(
                gantt_url(lab, "commit/"), {"token": response.json()["token"]}, format="json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: confirm(), range(2))) == [200, 409]
    assert IssueActivity.objects.filter(issue=a, field="start_date").count() == 1


def test_native_relation_api_shares_cycle_guard_and_invalidates_preview(laboratory, monkeypatch):
    from plane.bgtasks.issue_activities_task import issue_activity

    monkeypatch.setattr(issue_activity, "delay", lambda **kwargs: None)
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    b = task(lab, "B", "2026-10-10", "2026-10-11")
    response = preview(lab, a, "2026-10-05", "2026-10-06")
    client = lab["client"](lab["member"])
    native = f"/api/workspaces/lab/projects/{lab['project'].id}/issues/"
    created = client.post(
        native + f"{b.id}/issue-relation/", {"relation_type": "blocked_by", "issues": [str(a.id)]}, format="json"
    )
    assert created.status_code == 201, created.content
    assert (
        client.post(
            native + f"{a.id}/issue-relation/", {"relation_type": "blocked_by", "issues": [str(b.id)]}, format="json"
        ).status_code
        == 400
    )
    assert client.post(gantt_url(lab, "commit/"), {"token": response.json()["token"]}, format="json").status_code == 409


def test_confirmation_rechecks_permissions_before_changes(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    response = preview(lab, a, "2026-10-05", "2026-10-06")
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    assert lab["client"](lab["member"]).post(
        gantt_url(lab, "commit/"), {"token": response.json()["token"]}, format="json"
    ).status_code in (403, 404)
    a.refresh_from_db()
    assert a.target_date == date(2026, 10, 2)


def test_preview_token_is_bound_to_actor_and_expires(laboratory, monkeypatch):
    import time
    from django.core import signing

    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    response = preview(lab, a, "2026-10-05", "2026-10-06")
    body = {"token": response.json()["token"]}
    assert lab["client"](lab["reviewer"]).post(gantt_url(lab, "commit/"), body, format="json").status_code == 409
    current = time.time()
    monkeypatch.setattr(signing.time, "time", lambda: current + 301)
    assert lab["client"](lab["member"]).post(gantt_url(lab, "commit/"), body, format="json").status_code == 409


def test_native_relation_list_redacts_unreadable_external_tasks(laboratory):
    lab = laboratory
    a = task(lab, "A", "2026-10-01", "2026-10-02")
    foreign = Project.objects.create(workspace=lab["workspace"], name="Sensitive", identifier="SECRET")
    secret = Issue.objects.create(workspace=lab["workspace"], project=foreign, name="Never expose")
    IssueRelation.objects.create(
        workspace=lab["workspace"], project=lab["project"], issue=a, related_issue=secret, relation_type="blocked_by"
    )
    response = lab["client"](lab["member"]).get(
        f"/api/workspaces/lab/projects/{lab['project'].id}/issues/{a.id}/issue-relation/"
    )
    assert response.status_code == 200
    assert "Never expose" not in response.content.decode()
    assert str(secret.id) not in response.content.decode()
