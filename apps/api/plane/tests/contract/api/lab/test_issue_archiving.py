# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.db import close_old_connections
from django.utils import timezone

from plane.db.models import Issue, IssueActivity, Project, ProjectMember, State
from plane.lab.models import Audit, Bounty, Ledger, PersonalItem, TimeBlock
from plane.lab.vc import stage_budget, stage_reserved
from .test_contributions import award

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def task(lab, title="完成实验", completed="2026-10-15T15:59:59+00:00", state="done", **kwargs):
    row = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], state=lab["states"][state], name=title, **kwargs
    )
    Issue.objects.filter(id=row.id).update(completed_at=datetime.fromisoformat(completed) if completed else None)
    row.refresh_from_db()
    return row


def post(lab, path, data, user=None):
    return lab["client"](user or lab["lead"]).post(lab["base"] + path, data, format="json")


def preview(lab, **kwargs):
    return post(lab, "tasks/archive-preview/", {"cutoff": "2026-10-15", **kwargs})


def archive(lab, data, **kwargs):
    return post(lab, "tasks/archive/", {"preview_token": data["preview_token"]}, **kwargs)


def table(lab, **kwargs):
    response = lab["client"](lab["lead"]).get(lab["base"] + "task-table/", kwargs)
    assert response.status_code == 200, response.content
    return response.json()


def test_cutoff_is_inclusive_shanghai_completion_date_and_does_not_archive_until_confirmed(laboratory):
    lab = laboratory
    included = task(lab)
    boundary = task(lab, title="次日零点", completed="2026-10-15T16:00:00+00:00")
    task(lab, state="active")
    task(lab, title="未知完成时间", completed=None)
    result = preview(lab)
    assert result.status_code == 200, result.content
    data = result.json()
    assert data["total"] == 1 and data["tasks"][0]["id"] == str(included.id)
    assert data["tasks"][0]["completed_date"] == "2026-10-15"
    included.refresh_from_db()
    assert included.archived_at is None
    response = archive(lab, data)
    assert response.status_code == 200, response.content
    included.refresh_from_db()
    boundary.refresh_from_db()
    assert included.archived_at == timezone.localdate(timezone=timezone.get_fixed_timezone(480))
    assert boundary.archived_at is None
    assert str(included.id) not in {row["id"] for row in table(lab)["tasks"]}
    archived = table(lab, archived="1")["tasks"]
    assert len(archived) == 1 and archived[0]["id"] == str(included.id)
    assert archived[0]["editable"] is False and archived[0]["can_restore_issue"] is True


def test_preview_excludes_cancelled_draft_deleted_archived_and_other_projects(laboratory):
    lab = laboratory
    task(lab, is_draft=True)
    task(lab, archived_at=date(2026, 10, 16))
    task(lab, deleted_at=timezone.now())
    cancelled = State.objects.create(workspace=lab["workspace"], project=lab["project"], name="取消", group="cancelled")
    row = task(lab)
    Issue.objects.filter(id=row.id).update(state=cancelled)
    private = Project.objects.create(workspace=lab["workspace"], name="不可访问", identifier="PRIVATE")
    done = State.objects.create(workspace=lab["workspace"], project=private, name="完成", group="completed")
    Issue.objects.create(workspace=lab["workspace"], project=private, state=done, name="私密工作项")
    assert preview(lab).json() == {"cutoff": "2026-10-15", "total": 0, "preview_token": None, "tasks": []}


def test_project_scope_and_archive_date_filters_retain_original_work_item(laboratory):
    lab = laboratory
    row = task(lab)
    assert preview(lab, project_id=str(lab["project"].id)).json()["total"] == 1
    assert preview(lab, project_id="00000000-0000-4000-8000-000000000001").json()["total"] == 0
    assert archive(lab, preview(lab).json()).status_code == 200
    assert len(table(lab, archived="1", completed_from="2026-10-15", completed_to="2026-10-15")["tasks"]) == 1
    assert table(lab, archived="1", completed_from="2026-10-16")["tasks"] == []
    row.refresh_from_db()
    assert (
        len(
            table(
                lab, archived="1", archived_from=row.archived_at.isoformat(), archived_to=row.archived_at.isoformat()
            )["tasks"]
        )
        == 1
    )
    assert table(lab, archived="1", archived_to="2026-10-01")["tasks"] == []


def test_stale_preview_rolls_back_entire_batch_and_never_silently_includes_new_tasks(laboratory):
    lab = laboratory
    first, second = task(lab, title="甲"), task(lab, title="乙")
    data = preview(lab).json()
    late = task(lab, title="预览后新增完成项")
    Issue.objects.filter(id=second.id).update(name="内容已变", updated_at=timezone.now())
    assert archive(lab, data).status_code == 409
    assert not Issue.objects.filter(archived_at__isnull=False).exists()
    data = preview(lab).json()
    newer = task(lab, title="再次预览后新增完成项")
    assert archive(lab, data).json()["archived"] == 3
    newer.refresh_from_db()
    assert newer.archived_at is None
    assert {str(first.id), str(second.id), str(late.id)} == {r["id"] for r in table(lab, archived="1")["tasks"]}


def test_preview_tampering_and_different_actor_are_rejected(laboratory):
    lab = laboratory
    task(lab)
    data = preview(lab).json()
    assert archive(lab, {"preview_token": data["preview_token"] + "tamper"}).status_code == 409
    assert archive(lab, data, user=lab["member"]).status_code == 403
    assert post(lab, "tasks/archive/", {}).status_code == 400
    assert not Issue.objects.filter(archived_at__isnull=False).exists()


def test_revoked_membership_and_guest_do_not_gain_archive_or_restore_permissions(laboratory):
    lab = laboratory
    row = task(lab)
    data = preview(lab).json()
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(role=5)
    assert archive(lab, data).status_code == 409
    assert table(lab)["can_archive"] is False
    assert preview(lab).json()["total"] == 0
    Issue.objects.filter(id=row.id).update(archived_at=date(2026, 10, 17))
    assert post(lab, f"tasks/{row.id}/restore/", {"expected_revision": row.updated_at.isoformat()}).status_code == 404
    ProjectMember.objects.filter(project=lab["project"], member=lab["lead"]).update(role=15)
    assert table(lab, archived="1")["tasks"][0]["can_restore_issue"] is True


def test_retries_and_parallel_approvals_archive_once_with_one_activity_per_item(laboratory):
    lab = laboratory
    row = task(lab)
    data = preview(lab).json()

    def run(_):
        close_old_connections()
        try:
            result = archive(lab, data)
            return result.status_code, result.json()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert [status for status, _ in results] == [200, 200]
    assert {body["replayed"] for _, body in results} == {True, False}
    assert IssueActivity.objects.filter(issue=row, field="archived_at").count() == 1
    assert Audit.objects.filter(action="issue.archive_batch").count() == 1


def test_restore_retains_state_completion_and_references_and_old_retry_does_not_rearchive(laboratory):
    lab = laboratory
    row = task(lab)
    item = PersonalItem.objects.create(workspace=lab["workspace"], user=lab["lead"], issue=row, kind="project")
    block = TimeBlock.objects.create(item=item, start=timezone.now(), end=timezone.now() + timedelta(hours=1))
    completed = row.completed_at
    data = preview(lab).json()
    assert archive(lab, data).status_code == 200
    archived = table(lab, archived="1")["tasks"][0]
    response = post(lab, f"tasks/{row.id}/restore/", {"expected_revision": archived["revision"]})
    assert response.status_code == 200, response.content
    assert response.json() == {"restored": True}
    row.refresh_from_db()
    assert row.archived_at is None and row.completed_at == completed and row.state_id == lab["states"]["done"].id
    assert (
        PersonalItem.objects.filter(id=item.id, issue=row).exists() and TimeBlock.objects.filter(id=block.id).exists()
    )
    assert archive(lab, data).json()["replayed"] is True
    row.refresh_from_db()
    assert row.archived_at is None
    assert table(lab, archived="1")["tasks"] == []
    assert IssueActivity.objects.filter(issue=row, field="archived_at").count() == 2
    assert Audit.objects.filter(object_id=row.id, action="issue.restored").count() == 1


def test_old_restore_snapshot_cannot_restore_a_later_archive_cycle(laboratory):
    lab = laboratory
    row = task(lab)
    assert archive(lab, preview(lab).json()).status_code == 200
    old = table(lab, archived="1")["tasks"][0]["revision"]
    assert post(lab, f"tasks/{row.id}/restore/", {"expected_revision": old}).status_code == 200
    assert archive(lab, preview(lab).json()).status_code == 200
    assert post(lab, f"tasks/{row.id}/restore/", {"expected_revision": old}).status_code == 409
    row.refresh_from_db()
    assert row.archived_at is not None


def test_archive_preserves_awarded_vc_and_does_not_cascade_to_unfinished_children(laboratory):
    lab = laboratory
    bounty_id, issue, _ = award(lab)
    issue_id = issue.id
    bounty = Bounty.objects.select_related("stage").get(id=bounty_id)
    Issue.objects.filter(id=issue_id).update(completed_at=datetime.fromisoformat("2026-10-15T10:00:00+00:00"))
    child = task(lab, title="未完成子项", state="todo", completed=None, parent_id=issue_id)
    ledger = list(Ledger.objects.values_list("id", "delta"))
    budget, reserved = stage_budget(bounty.stage), stage_reserved(bounty.stage)
    assert archive(lab, preview(lab).json()).json()["archived"] == 1
    assert list(Ledger.objects.values_list("id", "delta")) == ledger and ledger[0][1] == Decimal("20")
    assert stage_budget(bounty.stage) == budget and stage_reserved(bounty.stage) == reserved
    child.refresh_from_db()
    assert child.archived_at is None
    bounty.refresh_from_db()
    assert bounty.status == "done" and bounty.issue_id == issue_id


def test_invalid_dates_and_ranges_are_rejected(laboratory):
    lab = laboratory
    for value in ["2026-02-30", "20261015", "bad", None, "9999-12-31"]:
        assert preview(lab, cutoff=value).status_code == 400
    client = lab["client"](lab["lead"])
    for params in [
        {"archived": "bad"},
        {"completed_from": "2026-10-16", "completed_to": "2026-10-15"},
        {"archived_to": "2026-99-99"},
    ]:
        assert client.get(lab["base"] + "task-table/", params).status_code == 400


def test_preview_expiry_and_cross_workspace_reuse_do_not_write(laboratory, monkeypatch):
    from django.core import signing
    from plane.db.models import Workspace, WorkspaceMember

    lab = laboratory
    task(lab)
    data = preview(lab).json()
    other = Workspace.objects.create(name="Other", slug="other", owner=lab["lead"])
    WorkspaceMember.objects.create(workspace=other, member=lab["lead"], role=20)
    response = lab["client"](lab["lead"]).post(
        "/api/workspaces/other/lab/tasks/archive/", {"preview_token": data["preview_token"]}, format="json"
    )
    assert response.status_code == 403
    expired = signing.time.time() + 901
    monkeypatch.setattr(signing.time, "time", lambda: expired)
    assert archive(lab, data).status_code == 409
    assert not Issue.objects.filter(archived_at__isnull=False).exists()


def test_archived_project_history_remains_findable_but_cannot_restore_until_project_reopens(laboratory):
    lab = laboratory
    row = task(lab)
    assert archive(lab, preview(lab).json()).status_code == 200
    Project.objects.filter(id=lab["project"].id).update(archived_at=timezone.now())
    record = table(lab, archived="1")["tasks"][0]
    assert record["id"] == str(row.id) and record["can_restore_issue"] is False
    assert preview(lab).json()["total"] == 0
    assert post(lab, f"tasks/{row.id}/restore/", {"expected_revision": record["revision"]}).status_code == 404
