# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""The personal contribution APIs retain one's own facts without granting project access."""

import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from plane.db.models import Page, PageVersion, Project, ProjectMember, ProjectPage, State, Workspace, WorkspaceMember
from plane.lab.bounty_models import BountyTaskAccess
from plane.lab.models import Allocation, Ledger
from .test_bounties import action, prepare, start
from .test_bounty_public_access import cross_member, approve_cross

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def award(lab, user=None, targets=("20",), title="个人贡献任务"):
    user = user or lab["member"]
    bounty, issue, _ = prepare(lab, title=title)
    if user.id == lab["member"].id:
        allocation = start(lab, bounty)
    else:
        claim = action(lab, user, bounty, "claim", {"planned": "20", "deliverable": "个人成果"})
        assert claim.status_code == 200, claim.content
        allocation = claim.json()["id"]
        assert action(lab, lab["lead"], bounty, "approve", {"allocation_id": allocation}).status_code == 200
        assert action(lab, user, bounty, "confirm").status_code == 200
        assert action(lab, lab["lead"], bounty, "start").status_code == 200
    for target in targets:
        assert action(lab, user, bounty, "submit", {"evidence": "私密执行成果"}).status_code == 200
        result = action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {
                "request_key": str(uuid.uuid4()),
                "result": "pass" if target == "20" else "partial",
                "targets": {allocation: target},
                "reason": "内部验收原因不可随摘要披露",
            },
        )
        assert result.status_code == 200, result.content
    return bounty, issue, allocation


def test_personal_overview_sums_own_net_ledger_and_keeps_zero_vc_memberships(laboratory):
    lab = laboratory
    bounty, _, _ = award(lab, targets=("10", "20"))
    lead = lab["client"](lab["lead"])
    entry = next(row for row in lead.get(lab["base"] + "ledger/").json() if row["bounty_id"] == bounty)
    assert (
        lead.post(
            lab["base"] + f"ledger/{entry['id']}/reverse/",
            {"request_key": str(uuid.uuid4()), "reason": "本人一笔贡献更正"},
            format="json",
        ).status_code
        == 200
    )
    award(lab, user=lab["lead"], title="他人的贡献任务")
    zero = Project.objects.create(workspace=lab["workspace"], name="尚无VC的项目", identifier="ZERO")
    ProjectMember.objects.create(workspace=lab["workspace"], project=zero, member=lab["member"], role=15)
    client = lab["client"](lab["member"])
    response = client.get(lab["base"] + "me/contributions/")
    assert response.status_code == 200, response.content
    assert response.json()["timezone"] == "Asia/Shanghai"
    assert response.json()["totals"] == {"earned": "20.00", "reversed": "10.00", "net": "10.00"}
    projects = {row["id"]: row for row in response.json()["projects"]}
    assert len(projects) == 2
    assert projects[str(lab["project"].id)] == {
        "id": str(lab["project"].id),
        "name": "Acoustics",
        "earned": "20.00",
        "reversed": "10.00",
        "net": "10.00",
        "participation": ["project", "bounty", "history"],
        "historical": False,
        "can_open_project": True,
    }
    assert projects[str(zero.id)]["net"] == "0.00" and projects[str(zero.id)]["participation"] == ["project"]
    assert client.get(lab["base"] + "me/contributions/").json() == response.json()


def accept_at(lab, bounty, allocation, target, instant, monkeypatch, result="partial", user=None):
    clock = datetime.fromisoformat(instant)
    monkeypatch.setattr(timezone, "now", lambda: clock)
    assert action(lab, user or lab["member"], bounty, "submit", {"evidence": "私密执行成果"}).status_code == 200
    response = action(
        lab,
        lab["reviewer"],
        bounty,
        "accept",
        {
            "request_key": str(uuid.uuid4()),
            "result": result,
            "targets": {allocation: target},
            "reason": "仅为本人贡献记录",
        },
    )
    assert response.status_code == 200, response.content
    return Ledger.objects.filter(bounty_id=bounty).order_by("-created_at", "-id").first()


def test_calendar_uses_shanghai_ledger_date_month_boundaries_and_zero_net_day(laboratory, monkeypatch):
    lab = laboratory
    bounty, _, _ = prepare(lab)
    allocation = start(lab, bounty)
    accept_at(lab, bounty, allocation, "1.01", "2026-09-30T15:59:59+00:00", monkeypatch)
    entry = accept_at(lab, bounty, allocation, "11.12", "2026-09-30T16:00:00+00:00", monkeypatch)
    clock = datetime.fromisoformat("2026-09-30T16:02:00+00:00")
    monkeypatch.setattr(timezone, "now", lambda: clock)
    assert (
        lab["client"](lab["lead"])
        .post(
            lab["base"] + f"ledger/{entry.id}/reverse/",
            {
                "request_key": str(uuid.uuid4()),
                "reason": "同日冲正保留获得记录",
            },
            format="json",
        )
        .status_code
        == 200
    )
    accept_at(lab, bounty, allocation, "1.08", "2026-10-31T15:59:59+00:00", monkeypatch)
    accept_at(lab, bounty, allocation, "20", "2026-10-31T16:00:00+00:00", monkeypatch, result="negative")
    client = lab["client"](lab["member"])
    endpoint = lab["base"] + "me/contributions/calendar/"
    response = client.get(endpoint, {"month": "2026-10"})
    assert response.status_code == 200, response.content
    assert response.json() == {
        "timezone": "Asia/Shanghai",
        "month": "2026-10",
        "totals": {"earned": "10.18", "reversed": "10.11", "net": "0.07"},
        "days": [
            {
                "day": "2026-10-01",
                "project_id": str(lab["project"].id),
                "project": "Acoustics",
                "earned": "10.11",
                "reversed": "10.11",
                "net": "0.00",
                "count": 2,
            },
            {
                "day": "2026-10-31",
                "project_id": str(lab["project"].id),
                "project": "Acoustics",
                "earned": "0.07",
                "reversed": "0.00",
                "net": "0.07",
                "count": 1,
            },
        ],
    }
    monkeypatch.setattr(timezone, "now", lambda: datetime.fromisoformat("2026-09-30T16:00:00+00:00"))
    assert client.get(endpoint).json() == response.json()
    assert client.get(endpoint, {"month": "2026-10", "project_id": str(lab["project"].id)}).json() == response.json()
    november = client.get(endpoint, {"month": "2026-11"}).json()
    assert november["totals"] == {"earned": "18.92", "reversed": "0.00", "net": "18.92"}
    assert november["days"][0]["day"] == "2026-11-01"


def test_entries_stable_fifty_row_cursor_and_current_source_capabilities(laboratory, monkeypatch):
    lab = laboratory
    bounty, issue, _ = prepare(lab, title="获得记录分页任务")
    allocation = start(lab, bounty)
    instant = "2026-10-02T01:00:00+00:00"
    for number in range(1, 52):
        accept_at(lab, bounty, allocation, str(Decimal(number) / 100), instant, monkeypatch)
    expected = sorted((str(value) for value in Ledger.objects.values_list("id", flat=True)), reverse=True)
    client = lab["client"](lab["member"])
    endpoint = lab["base"] + "me/contributions/entries/"
    response = client.get(endpoint, {"month": "2026-10", "day": "2026-10-02", "project_id": str(lab["project"].id)})
    assert response.status_code == 200, response.content
    data = response.json()
    assert data["timezone"] == "Asia/Shanghai" and len(data["results"]) == 50 and data["next_cursor"]
    assert [row["id"] for row in data["results"]] == expected[:50]
    assert data["results"][0] == {
        "id": expected[0],
        "created_at": instant,
        "day": "2026-10-02",
        "project_id": str(lab["project"].id),
        "project": "Acoustics",
        "task_id": str(issue.id),
        "task_title": "获得记录分页任务",
        "bounty_id": bounty,
        "delta": "0.01",
        "kind": "award",
        "reverses": None,
        "archived": False,
        "can_open_issue": True,
        "can_open_bounty": True,
    }
    accept_at(lab, bounty, allocation, "0.52", "2026-10-03T01:00:00+00:00", monkeypatch)
    second = client.get(
        endpoint,
        {
            "month": "2026-10",
            "day": "2026-10-02",
            "project_id": str(lab["project"].id),
            "cursor": data["next_cursor"],
        },
    )
    assert second.status_code == 200, second.content
    assert [row["id"] for row in second.json()["results"]] == expected[50:]
    assert second.json()["next_cursor"] is None
    assert client.get(endpoint, {"month": "2026-10", "day": "2026-10-03"}).json()["results"][0]["day"] == "2026-10-03"
    for query, user in (
        ({"month": "2026-11", "day": "2026-11-02", "project_id": str(lab["project"].id)}, lab["member"]),
        ({"month": "2026-10", "day": "2026-10-03", "project_id": str(lab["project"].id)}, lab["member"]),
        ({"month": "2026-10", "day": "2026-10-02"}, lab["member"]),
        ({"month": "2026-10", "day": "2026-10-02", "project_id": str(lab["project"].id)}, lab["lead"]),
    ):
        assert lab["client"](user).get(endpoint, {**query, "cursor": data["next_cursor"]}).status_code == 400
    assert client.get(endpoint, {"month": "2026-10", "cursor": data["next_cursor"] + "tampered"}).status_code == 400
    monthly_cursor = client.get(endpoint, {"month": "2026-10"}).json()["next_cursor"]
    another = Workspace.objects.create(name="Cursor scope", slug="cursor-scope", owner=lab["lead"])
    WorkspaceMember.objects.create(workspace=another, member=lab["member"], role=15)
    assert (
        client.get(
            "/api/workspaces/cursor-scope/lab/me/contributions/entries/",
            {
                "month": "2026-10",
                "cursor": monthly_cursor,
            },
        ).status_code
        == 400
    )


def contribution_entry(lab, user, entry):
    month = entry.created_at.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")
    response = lab["client"](user).get(lab["base"] + "me/contributions/entries/", {"month": month})
    assert response.status_code == 200, response.content
    return next(row for row in response.json()["results"] if row["id"] == str(entry.id))


def test_archived_issue_keeps_authorized_native_and_bounty_history_links(laboratory):
    lab = laboratory
    bounty, issue, _ = award(lab)
    entry = Ledger.objects.get(bounty_id=bounty)
    issue.archived_at = timezone.now()
    issue.save(update_fields=["archived_at"])
    archived = contribution_entry(lab, lab["member"], entry)
    assert archived["archived"] and archived["can_open_issue"] and archived["can_open_bounty"]


def test_exit_keeps_own_snapshot_and_does_not_restore_project_or_execution_access(laboratory):
    lab = laboratory
    bounty, issue, _ = award(lab, title="离组前贡献")
    entry = Ledger.objects.get(bounty_id=bounty)
    client = lab["client"](lab["member"])
    lab["project"].name = "后来改名的私有项目"
    lab["project"].save(update_fields=["name"])
    issue.name = "后来私密执行名称"
    issue.save(update_fields=["name"])
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    response = client.get(lab["base"] + "me/contributions/")
    assert response.status_code == 200
    assert response.json()["projects"] == [
        {
            "id": str(lab["project"].id),
            "name": "Acoustics",
            "earned": "20.00",
            "reversed": "0.00",
            "net": "20.00",
            "participation": ["bounty", "history"],
            "historical": True,
            "can_open_project": False,
        }
    ]
    own = contribution_entry(lab, lab["member"], entry)
    assert own["task_title"] == "离组前贡献" and own["project"] == "Acoustics"
    assert not own["can_open_issue"] and not own["can_open_bounty"]
    assert "后来" not in str(response.json()) and "私密执行成果" not in str(own) and "内部验收原因" not in str(own)
    native = f"/api/workspaces/lab/projects/{lab['project'].id}/issues/{issue.id}/"
    assert client.get(native).status_code in (403, 404)
    assert client.get(lab["base"] + "tasks/").json() == []
    assert client.get(lab["base"] + "ledger/", {"project_id": str(lab["project"].id)}).json() == []
    assert client.get(lab["base"] + f"bounties/{bounty}/materials/").status_code in (403, 404)


def test_cross_project_zero_vc_confirmation_and_revocation_keep_only_personal_history(laboratory):
    lab = laboratory
    user = cross_member(lab)
    client = lab["client"](user)
    bounty, issue, _ = prepare(lab, title="跨项目本人贡献")
    allocation = approve_cross(lab, bounty, user)
    assert client.get(lab["base"] + "me/contributions/").json()["projects"] == []
    assert action(lab, user, bounty, "confirm").status_code == 200
    project = client.get(lab["base"] + "me/contributions/").json()["projects"][0]
    assert project["net"] == "0.00" and project["participation"] == ["bounty"]
    assert not project["historical"] and not project["can_open_project"]
    assert action(lab, lab["lead"], bounty, "start").status_code == 200
    assert action(lab, user, bounty, "submit", {"evidence": "私密执行成果"}).status_code == 200
    assert (
        action(
            lab,
            lab["reviewer"],
            bounty,
            "accept",
            {
                "request_key": str(uuid.uuid4()),
                "result": "negative",
                "targets": {allocation: "20"},
                "reason": "有效探索",
            },
        ).status_code
        == 200
    )
    entry = Ledger.objects.get(bounty_id=bounty)
    own = contribution_entry(lab, user, entry)
    assert own["delta"] == "20.00" and own["kind"] == "award" and own["can_open_bounty"] and not own["can_open_issue"]
    page = Page.objects.create(workspace=lab["workspace"], owned_by=lab["lead"], name="私密执行资料")
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)
    version = PageVersion.objects.create(
        workspace=lab["workspace"],
        page=page,
        owned_by=lab["lead"],
        description_html="<p>PRIVATE-EXECUTION-MATERIAL</p>",
    )
    materials = lab["base"] + f"bounties/{bounty}/materials/"
    shared = lab["client"](lab["lead"]).post(
        materials, {"kind": "document_version", "page_version_id": str(version.id)}, format="json"
    )
    assert shared.status_code == 201, shared.content
    material_path = materials + shared.json()["id"] + "/"
    assert client.get(material_path).status_code == 200
    BountyTaskAccess.objects.filter(allocation_id=allocation).update(revoked_at=timezone.now())
    historical = client.get(lab["base"] + "me/contributions/").json()
    assert historical["totals"]["net"] == "20.00"
    assert (
        historical["projects"][0]["participation"] == ["bounty", "history"] and historical["projects"][0]["historical"]
    )
    own = contribution_entry(lab, user, entry)
    assert not own["can_open_issue"] and not own["can_open_bounty"] and "PRIVATE-EXECUTION" not in str(own)
    assert client.get(material_path).status_code in (403, 404)
    assert client.get(lab["base"] + f"projects/{lab['project'].id}/documents/").status_code == 404
    assert not ProjectMember.objects.filter(project=lab["project"], member=user).exists()


def test_bounty_and_native_task_deletion_preserve_history_without_deleted_detail_links(laboratory):
    lab = laboratory
    bounty, issue, _ = award(lab, title="删除前获得的贡献")
    entry = Ledger.objects.get(bounty_id=bounty)
    lead = lab["client"](lab["lead"])
    assert (
        lead.delete(lab["base"] + f"bounties/{bounty}/detail/", {"reason": "删除已完成卡片"}, format="json").status_code
        == 204
    )
    own = contribution_entry(lab, lab["member"], entry)
    assert own["can_open_issue"] and not own["can_open_bounty"] and not own["archived"]
    assert lead.delete(lab["base"] + f"tasks/{issue.id}/", {"reason": "删除原工作项"}, format="json").status_code == 204
    own = contribution_entry(lab, lab["member"], entry)
    assert own["delta"] == "20.00" and own["task_title"] == "删除前获得的贡献"
    assert not own["can_open_issue"] and not own["can_open_bounty"] and not own["archived"]
    client = lab["client"](lab["member"])
    assert client.get(lab["base"] + "me/contributions/").json()["totals"]["net"] == "20.00"
    month = entry.created_at.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")
    assert client.get(lab["base"] + "me/contributions/calendar/", {"month": month}).json()["days"][0]["net"] == "20.00"
    lab["project"].delete(soft=False)
    project = client.get(lab["base"] + "me/contributions/").json()["projects"][0]
    assert project["net"] == "20.00" and project["name"] == "Acoustics" and project["historical"]
    assert project["participation"] == ["bounty", "history"] and not project["can_open_project"]
    assert contribution_entry(lab, lab["member"], entry)["task_title"] == "删除前获得的贡献"


@pytest.mark.parametrize("path", ("", "calendar/", "entries/"))
def test_personal_endpoints_reject_other_user_selection_and_inactive_workspace_members(laboratory, path):
    lab = laboratory
    endpoint = lab["base"] + "me/contributions/" + path
    for user in (lab["member"], lab["lead"]):
        assert lab["client"](user).get(endpoint, {"user_id": str(lab["reviewer"].id)}).status_code == 400
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["member"]).update(is_active=False)
    assert lab["client"](lab["member"]).get(endpoint).status_code == 403


def other_workspace(lab):
    workspace = Workspace.objects.create(name="Other", slug="other", owner=lab["lead"])
    project = Project.objects.create(
        workspace=workspace, name="Other private project", identifier="OTHER", project_lead=lab["lead"]
    )
    for user in (lab["lead"], lab["member"], lab["reviewer"], lab["independent"]):
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=15)
    states = {
        key: State.objects.create(workspace=workspace, project=project, name=key, group=state.group)
        for key, state in lab["states"].items()
    }
    return {**lab, "workspace": workspace, "project": project, "states": states, "base": "/api/workspaces/other/lab/"}


def test_workspace_filter_and_project_filter_never_include_other_scope_amounts(laboratory):
    lab = laboratory
    bounty, _, _ = award(lab)
    entry = Ledger.objects.get(bounty_id=bounty)
    other = other_workspace(lab)
    other_bounty, _, _ = award(other)
    client = lab["client"](lab["member"])
    overview = client.get(lab["base"] + "me/contributions/").json()
    assert overview["totals"]["net"] == "20.00" and [row["id"] for row in overview["projects"]] == [
        str(lab["project"].id)
    ]
    month = entry.created_at.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")
    for path in ("calendar/", "entries/"):
        response = client.get(lab["base"] + "me/contributions/" + path, {"month": month})
        assert (
            response.status_code == 200
            and "Other private project" not in str(response.json())
            and other_bounty not in str(response.json())
        )
        assert (
            client.get(
                lab["base"] + "me/contributions/" + path, {"month": month, "project_id": str(other["project"].id)}
            ).status_code
            == 404
        )
    assert client.get(other["base"] + "me/contributions/").json()["totals"]["net"] == "20.00"


def test_confirmed_zero_vc_participation_survives_grant_revocation_and_bounty_deletion(laboratory):
    lab = laboratory
    user = cross_member(lab)
    bounty, _, _ = prepare(lab)
    allocation = approve_cross(lab, bounty, user)
    assert action(lab, user, bounty, "confirm").status_code == 200
    client = lab["client"](user)
    BountyTaskAccess.objects.filter(allocation_id=allocation).update(revoked_at=timezone.now())
    snapshot = client.get(lab["base"] + "me/contributions/").json()
    assert snapshot["totals"] == {"earned": "0.00", "reversed": "0.00", "net": "0.00"}
    assert snapshot["projects"][0]["participation"] == ["bounty"] and snapshot["projects"][0]["historical"]
    assert not snapshot["projects"][0]["can_open_project"]
    assert (
        lab["client"](lab["lead"])
        .delete(
            lab["base"] + f"bounties/{bounty}/detail/",
            {
                "reason": "取消零VC的已确认参与",
            },
            format="json",
        )
        .status_code
        == 204
    )
    assert client.get(lab["base"] + "me/contributions/").json() == snapshot


def test_immutable_recipient_uuid_precedes_allocation_and_missing_legacy_uuid_has_narrow_fallback(laboratory):
    lab = laboratory
    bounty, _, allocation_id = award(lab, targets=("10",))
    original = Ledger.objects.get(bounty_id=bounty)
    # These appended rows represent legacy imports, which can omit recipient IDs.
    for snapshot, delta in (
        ({}, "0.01"),
        ({"id": None}, "0.01"),
        ({"id": ""}, "0.01"),
        ({"id": str(lab["lead"].id)}, "0.02"),
    ):
        Ledger.objects.create(
            bounty_id=bounty,
            allocation_id=allocation_id,
            delta=delta,
            actor=lab["reviewer"],
            actor_name="验收人",
            reason="导入历史摘要",
            task_snapshot=original.task_snapshot,
            participant_snapshot=snapshot,
            request_key=uuid.uuid4(),
        )
    Allocation.objects.filter(id=allocation_id).update(user=lab["lead"])
    member = lab["client"](lab["member"])
    lead = lab["client"](lab["lead"])
    assert member.get(lab["base"] + "me/contributions/").json()["totals"] == {
        "earned": "10.03",
        "reversed": "0.00",
        "net": "10.03",
    }
    assert lead.get(lab["base"] + "me/contributions/").json()["totals"]["net"] == "0.02"
    month = original.created_at.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")
    for path in ("calendar/", "entries/"):
        payload = member.get(lab["base"] + "me/contributions/" + path, {"month": month}).json()
        if path == "calendar/":
            assert payload["totals"]["net"] == "10.03" and payload["days"][0]["count"] == 4
        else:
            assert len(payload["results"]) == 4 and sum(Decimal(row["delta"]) for row in payload["results"]) == Decimal(
                "10.03"
            )


def test_legacy_snapshot_projection_never_returns_nested_execution_material(laboratory):
    lab = laboratory
    bounty, issue, _ = award(lab, targets=("10",), title="原历史任务标题")
    original = Ledger.objects.get(bounty_id=bounty)
    entry = Ledger.objects.create(
        bounty_id=bounty,
        allocation_id=original.allocation_id,
        delta="0.01",
        actor=lab["reviewer"],
        actor_name="验收人",
        reason="历史记录",
        participant_snapshot={"id": str(lab["member"].id)},
        request_key=uuid.uuid4(),
        task_snapshot={"title": {"evidence": "PRIVATE-EXECUTION"}, "project": ["PRIVATE-EXECUTION"]},
    )
    row = contribution_entry(lab, lab["member"], entry)
    assert row["task_id"] == str(issue.id) and row["task_title"] == "原历史任务标题" and row["project"] == "Acoustics"
    assert "PRIVATE-EXECUTION" not in str(row)


@pytest.mark.parametrize("path", ("calendar/", "entries/"))
def test_period_inputs_fail_clearly_and_empty_periods_keep_decimal_strings(laboratory, path):
    client = laboratory["client"](laboratory["member"])
    endpoint = laboratory["base"] + "me/contributions/" + path
    for month in ("2026-13", "2026-1", "2026-00", "2026-10-01", "0000-01", "9999-12", ""):
        assert client.get(endpoint, {"month": month}).status_code == 400
    assert client.get(endpoint, {"month": "2026-10", "project_id": "invalid"}).status_code == 400
    assert client.get(endpoint, {"month": "2026-10", "project_id": str(uuid.uuid4())}).status_code == 404
    if path == "entries/":
        for day in ("2026-09-30", "2026-10-32", "2026-10-1", "2026-W40-1", ""):
            assert client.get(endpoint, {"month": "2026-10", "day": day}).status_code == 400
        assert client.get(endpoint, {"month": "2026-10", "cursor": "bad"}).status_code == 400
        assert client.get(endpoint, {"month": "2026-10"}).json() == {
            "timezone": "Asia/Shanghai",
            "results": [],
            "next_cursor": None,
        }
    else:
        assert client.get(endpoint, {"month": "2026-10"}).json() == {
            "timezone": "Asia/Shanghai",
            "month": "2026-10",
            "totals": {"earned": "0.00", "reversed": "0.00", "net": "0.00"},
            "days": [],
        }


def test_same_workspace_project_totals_and_same_day_groups_remain_independent_of_period_filters(
    laboratory, monkeypatch
):
    lab = laboratory
    clock = datetime.fromisoformat("2026-10-15T15:30:00+00:00")
    monkeypatch.setattr(timezone, "now", lambda: clock)
    first_bounty, _, _ = award(lab, targets=("10.01",), title="声学项目本人贡献")
    project = Project.objects.create(
        workspace=lab["workspace"], name="Hydrophone", identifier="HP", project_lead=lab["lead"]
    )
    for user in (lab["lead"], lab["member"], lab["reviewer"], lab["independent"]):
        ProjectMember.objects.create(
            workspace=lab["workspace"], project=project, member=user, role=20 if user == lab["lead"] else 15
        )
    states = {
        key: State.objects.create(
            workspace=lab["workspace"], project=project, name=key, group=state.group, default=key == "todo"
        )
        for key, state in lab["states"].items()
    }
    second_lab = {**lab, "project": project, "states": states}
    second_bounty, second_issue, _ = award(second_lab, title="水听器项目本人贡献")
    client = lab["client"](lab["member"])
    endpoint = lab["base"] + "me/contributions/"
    summary = client.get(endpoint)
    assert summary.status_code == 200, summary.content
    initial = summary.json()
    assert initial["totals"] == {"earned": "30.01", "reversed": "0.00", "net": "30.01"}
    projects = {row["id"]: row for row in initial["projects"]}
    assert set(projects) == {str(lab["project"].id), str(project.id)}
    for project_id, amount in ((str(lab["project"].id), "10.01"), (str(project.id), "20.00")):
        assert {key: projects[project_id][key] for key in ("earned", "reversed", "net")} == {
            "earned": amount,
            "reversed": "0.00",
            "net": amount,
        }
        assert projects[project_id]["participation"] == ["project", "bounty", "history"]
    calendar = client.get(endpoint + "calendar/", {"month": "2026-10"})
    assert calendar.status_code == 200, calendar.content
    assert calendar.json()["totals"] == initial["totals"]
    days = {row["project_id"]: row for row in calendar.json()["days"]}
    assert len(calendar.json()["days"]) == 2
    assert days == {
        str(lab["project"].id): {
            "day": "2026-10-15",
            "project_id": str(lab["project"].id),
            "project": "Acoustics",
            "earned": "10.01",
            "reversed": "0.00",
            "net": "10.01",
            "count": 1,
        },
        str(project.id): {
            "day": "2026-10-15",
            "project_id": str(project.id),
            "project": "Hydrophone",
            "earned": "20.00",
            "reversed": "0.00",
            "net": "20.00",
            "count": 1,
        },
    }
    query = {"month": "2026-10", "project_id": str(project.id)}
    filtered = client.get(endpoint + "calendar/", query).json()
    assert filtered["totals"] == {"earned": "20.00", "reversed": "0.00", "net": "20.00"}
    assert filtered["days"] == [days[str(project.id)]]
    entries = client.get(endpoint + "entries/", {**query, "day": "2026-10-15"})
    assert entries.status_code == 200, entries.content
    assert len(entries.json()["results"]) == 1
    own = entries.json()["results"][0]
    assert own["bounty_id"] == second_bounty and own["task_id"] == str(second_issue.id)
    assert own["delta"] == "20.00" and own["project_id"] == str(project.id) and first_bounty not in str(entries.json())
    assert client.get(endpoint + "calendar/", {**query, "month": "2026-11"}).json()["totals"]["net"] == "0.00"
    assert client.get(endpoint + "entries/", {**query, "month": "2026-11"}).json()["results"] == []
    assert client.get(endpoint).json() == initial
