# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Project publication can use native default states while preserving explicit mappings."""

from datetime import timedelta
from decimal import Decimal
import uuid

import pytest
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Issue, State
from plane.db.models.state import DEFAULT_STATES
from plane.lab.bounty_flow import ensure_bounty_flow
from plane.lab.models import Audit, Bounty, PersonalCategory, PersonalItem, ProjectFlow, Stage, TimeBlock
from .test_bounty_project_budget import publication

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def native_states(lab):
    State.objects.filter(project=lab["project"]).delete(soft=False)
    State.objects.bulk_create(
        [State(workspace=lab["workspace"], project=lab["project"], **definition) for definition in DEFAULT_STATES]
    )
    states = {state.name: state for state in State.objects.filter(project=lab["project"])}
    lab["states"] = {"todo": states["Backlog"], "active": states["In Progress"], "done": states["Done"]}
    return states


def vc_budget(lab):
    result = lab["client"](lab["lead"]).post(
        lab["base"] + "stages/",
        {"project_id": str(lab["project"].id), "name": "当前预算", "budget": "100"},
        format="json",
    )
    assert result.status_code == 201, result.content
    return result.json()["id"]


def issue(lab):
    return Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="原生工作项", state=lab["states"]["todo"]
    )


def publish(lab, task, **extra):
    return lab["client"](lab["lead"]).post(lab["base"] + "bounties/", publication(lab, task, **extra), format="json")


def test_native_default_project_publishes_and_preserves_original_states_planning_and_colors(laboratory):
    lab = laboratory
    native = native_states(lab)
    stage_id = vc_budget(lab)
    task = issue(lab)
    category = PersonalCategory.objects.create(
        workspace=lab["workspace"], user=lab["member"], name="自定义", color="#8e44ad"
    )
    item = PersonalItem.objects.create(workspace=lab["workspace"], user=lab["member"], issue=task, category=category)
    start = timezone.now() + timedelta(days=1)
    block = TimeBlock.objects.create(item=item, start=start, end=start + timedelta(hours=1), color="#3498db")
    state_snapshot = list(State.all_state_objects.filter(project=lab["project"]).order_by("id").values())
    item_snapshot = PersonalItem.objects.filter(id=item.id).values().get()
    block_snapshot = TimeBlock.objects.filter(id=block.id).values().get()
    lead = lab["client"](lab["lead"])
    assert lead.get(lab["base"] + "bounties/budgets/").status_code == 200
    assert lead.get(lab["base"] + f"tasks/?project_id={lab['project'].id}&publishable=1").status_code == 200
    assert not ProjectFlow.objects.exists()

    result = publish(lab, task)
    assert result.status_code == 201, result.content
    row = Bounty.objects.get(id=result.json()["id"])
    assert str(row.stage_id) == stage_id and row.reserved == Decimal("10")
    flow = ProjectFlow.objects.get(project=lab["project"])
    assert flow.todo_id == native["Backlog"].id
    assert flow.active_id == native["In Progress"].id and flow.done_id == native["Done"].id
    assert flow.review.name == "待验收" and flow.review.group == "started" and flow.review_id != flow.active_id
    assert State.all_state_objects.filter(project=lab["project"]).count() == len(state_snapshot) + 1
    assert state_snapshot == list(
        State.all_state_objects.filter(id__in=[state["id"] for state in state_snapshot]).order_by("id").values()
    )
    assert PersonalItem.objects.filter(id=item.id).values().get() == item_snapshot
    assert TimeBlock.objects.filter(id=block.id).values().get() == block_snapshot
    category.refresh_from_db()
    task.refresh_from_db()
    assert category.color == "#8e44ad" and task.state_id == native["Backlog"].id
    audit = Audit.objects.get(action="planning.state_mapping", object_id=flow.id)
    assert audit.actor_id == lab["lead"].id and audit.details["source"] == "project_bounty_auto"
    assert audit.details["states"]["review"] == str(flow.review_id)
    assert ensure_bounty_flow(lab["lead"], lab["project"]).id == flow.id
    assert Audit.objects.filter(action="planning.state_mapping").count() == 1


@pytest.mark.parametrize("name", ["待验收", "Review", "In Review"])
def test_existing_native_review_state_is_reused_without_changing_its_color(laboratory, name):
    lab = laboratory
    native_states(lab)
    review = State.objects.create(
        workspace=lab["workspace"], project=lab["project"], name=name, group="started", color="#a855f7"
    )
    vc_budget(lab)
    task = issue(lab)
    before = list(State.all_state_objects.filter(project=lab["project"]).order_by("id").values())
    response = publish(lab, task)
    assert response.status_code == 201, response.content
    assert ProjectFlow.objects.get(project=lab["project"]).review_id == review.id
    assert before == list(State.all_state_objects.filter(project=lab["project"]).order_by("id").values())


def test_existing_complete_and_partial_custom_mappings_are_never_replaced(laboratory):
    lab = laboratory
    mapping = {key: state for key, state in lab["states"].items()}
    flow = ProjectFlow.objects.create(project=lab["project"], **mapping)
    vc_budget(lab)
    response = publish(lab, issue(lab))
    assert response.status_code == 201, response.content
    assert {key: getattr(ProjectFlow.objects.get(id=flow.id), f"{key}_id") for key in mapping} == {
        key: state.id for key, state in mapping.items()
    }
    ProjectFlow.objects.filter(id=flow.id).update(review=None)
    before = ProjectFlow.objects.filter(id=flow.id).values().get()
    states = State.objects.count()
    response = publish(lab, issue(lab))
    assert response.status_code == 400 and "映射" in str(response.json())
    assert ProjectFlow.objects.filter(id=flow.id).values().get() == before
    assert State.objects.count() == states and not Audit.objects.filter(action="planning.state_mapping").exists()


def test_legacy_stage_publication_keeps_explicit_mapping_requirement(laboratory):
    lab = laboratory
    native_states(lab)
    stage_id = vc_budget(lab)
    task = issue(lab)
    body = publication(lab, task)
    body.pop("project_id")
    body["stage_id"] = stage_id
    before = State.objects.count()
    response = lab["client"](lab["lead"]).post(lab["base"] + "bounties/", body, format="json")
    assert response.status_code == 400 and "映射" in str(response.json())
    assert not ProjectFlow.objects.exists() and State.objects.count() == before and not Bounty.objects.exists()


@pytest.mark.parametrize("group,label", [("started", "进行中"), ("completed", "完成")])
def test_missing_native_groups_fail_clearly_without_creating_mapping_or_review(laboratory, group, label):
    lab = laboratory
    native_states(lab)
    State.objects.filter(project=lab["project"], group=group).delete(soft=False)
    vc_budget(lab)
    task = issue(lab)
    before = State.objects.count()
    response = publish(lab, task)
    assert response.status_code == 400 and label in str(response.json())
    assert not ProjectFlow.objects.exists() and State.objects.count() == before and not Bounty.objects.exists()


def test_invalid_publication_rolls_back_auto_mapping_review_state_and_audit(laboratory):
    lab = laboratory
    native_states(lab)
    stage_id = vc_budget(lab)
    task = issue(lab)
    before = State.objects.count()
    result = publish(lab, task, reviewer_id=str(uuid.uuid4()))
    assert result.status_code == 400
    assert not ProjectFlow.objects.exists() and not Bounty.objects.exists() and State.objects.count() == before
    assert not Audit.objects.filter(action="planning.state_mapping").exists()
    assert Stage.objects.get(id=stage_id).budget == Decimal("100")


def test_auto_mapping_helper_requires_the_project_lead(laboratory):
    lab = laboratory
    native_states(lab)
    before = State.objects.count()
    with pytest.raises(PermissionDenied):
        ensure_bounty_flow(lab["member"], lab["project"])
    assert not ProjectFlow.objects.exists() and State.objects.count() == before


def test_review_name_collision_appends_a_distinct_state_and_preserves_the_existing_one(laboratory):
    lab = laboratory
    native_states(lab)
    original = State.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="待验收", group="unstarted", color="#123456"
    )
    another = State.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="悬赏待验收", group="completed", color="#abcdef"
    )
    vc_budget(lab)
    task = issue(lab)
    before = list(State.all_state_objects.filter(project=lab["project"]).order_by("id").values())
    result = publish(lab, task)
    assert result.status_code == 201, result.content
    flow = ProjectFlow.objects.get(project=lab["project"])
    assert flow.review.name == "悬赏待验收 2" and flow.review.group == "started"
    assert flow.review_id not in (original.id, another.id)
    assert before == list(
        State.all_state_objects.filter(id__in=[state["id"] for state in before]).order_by("id").values()
    )
