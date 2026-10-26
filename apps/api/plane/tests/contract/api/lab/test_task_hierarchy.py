# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest
from plane.db.models import Issue, IssueAssignee, ProjectMember
from plane.lab.models import PersonalItem

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def make_issue(lab, name, parent=None, creator=None, **kwargs):
    row = Issue(workspace=lab["workspace"], project=lab["project"], name=name, parent=parent, **kwargs)
    row.save(created_by_id=(creator or lab["lead"]).id)
    return row


def test_task_hierarchy_preserves_native_parent_and_assignment(laboratory):
    lab = laboratory
    parent = make_issue(lab, "父工作项")
    child = make_issue(lab, "子工作项", parent)
    IssueAssignee.objects.create(
        workspace=lab["workspace"], project=lab["project"], issue=child, assignee=lab["member"]
    )
    data = lab["client"](lab["member"]).get(lab["base"] + "task-table/").json()
    rows = {row["id"]: row for row in data["tasks"]}
    assert rows[str(child.id)]["parent_id"] == str(parent.id)
    assert rows[str(parent.id)]["parent_id"] is None
    assert rows[str(child.id)]["is_mine"] is True
    assert rows[str(parent.id)]["is_mine"] is False
    assert rows[str(child.id)]["assignees"][0]["id"] == str(lab["member"].id)


def test_task_hierarchy_does_not_disclose_inaccessible_parent(laboratory):
    lab = laboratory
    parent = make_issue(lab, "负责人私有父工作项")
    child = make_issue(lab, "访客创建的子项", parent, creator=lab["member"])
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    response = lab["client"](lab["member"]).get(lab["base"] + "task-table/")
    rows = response.json()["tasks"]
    assert [row["id"] for row in rows] == [str(child.id)]
    assert rows[0]["parent_id"] is None
    assert str(parent.id) not in response.content.decode()
    assert parent.name not in response.content.decode()


def test_task_hierarchy_excludes_draft_parents_and_keeps_personal_tasks_private(laboratory):
    lab = laboratory
    parent = make_issue(lab, "草稿父项", is_draft=True)
    child = make_issue(lab, "可见子项", parent)
    private = PersonalItem.objects.create(
        workspace=lab["workspace"], user=lab["lead"], title="个人私有工作项", kind="research"
    )
    client = lab["client"](lab["member"])
    rows = client.get(lab["base"] + "task-table/").json()["tasks"]
    assert [row["id"] for row in rows] == [str(child.id)]
    assert rows[0]["parent_id"] is None
    planner = client.get(lab["base"] + "planner/").json()
    assert str(private.id) not in {row["id"] for row in planner["items"] + planner["shared_items"]}
