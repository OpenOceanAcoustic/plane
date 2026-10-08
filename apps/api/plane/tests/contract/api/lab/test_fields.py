# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest
from plane.db.models import Issue, ProjectMember

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def definition(lab, kind, options=None):
    response = lab["client"](lab["lead"]).post(
        lab["base"] + "field-definitions/",
        {"name": kind, "kind": kind, "options": options or []},
        format="json",
    )
    assert response.status_code == 201, response.content
    field = response.json()
    enabled = lab["client"](lab["lead"]).put(
        lab["base"] + f"projects/{lab['project'].id}/fields/",
        {"ids": [field["id"]]},
        format="json",
    )
    assert enabled.status_code == 200
    return field


@pytest.mark.parametrize(
    "kind,value,invalid",
    [
        ("text", "实验配置", ["array"]),
        ("number", 12.5, True),
        ("single_select", "sea", "unknown"),
        ("multi_select", ["sea", "tank"], ["sea", "sea"]),
        ("date", "2026-10-08", "2026-02-30"),
        ("boolean", False, 1),
        ("url", "https://example.org/experiment", "javascript:alert(1)"),
    ],
)
def test_field_types_are_validated_and_clearable(laboratory, kind, value, invalid):
    lab = laboratory
    field = definition(lab, kind, ["sea", "tank"] if "select" in kind else [])
    issue = Issue.objects.create(workspace=lab["workspace"], project=lab["project"], name="实验")
    client = lab["client"](lab["member"])
    url = lab["base"] + f"tasks/{issue.id}/field-values/"
    assert client.patch(url, {"values": {field["id"]: value}}, format="json").status_code == 200
    assert client.get(url).json()["values"][field["id"]] == value
    assert client.patch(url, {"values": {field["id"]: invalid}}, format="json").status_code == 400
    assert client.get(url).json()["values"][field["id"]] == value
    assert client.patch(url, {"values": {field["id"]: None}}, format="json").status_code == 200
    assert client.get(url).json()["values"][field["id"]] is None


def test_field_roles_member_scope_and_archive_preserve_values(laboratory):
    lab = laboratory
    lead, member = lab["client"](lab["lead"]), lab["client"](lab["member"])
    base = lab["base"]
    assert member.post(base + "field-definitions/", {"name": "秘密", "kind": "text"}, format="json").status_code == 403
    field = definition(lab, "member")
    issue = Issue.objects.create(workspace=lab["workspace"], project=lab["project"], name="实验")
    url = base + f"tasks/{issue.id}/field-values/"
    assert member.put(base + f"projects/{lab['project'].id}/fields/", {"ids": []}, format="json").status_code == 403
    assert member.patch(url, {"values": {field["id"]: str(lab["reviewer"].id)}}, format="json").status_code == 200
    ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(is_active=False)
    assert member.patch(url, {"values": {field["id"]: str(lab["reviewer"].id)}}, format="json").status_code == 400
    assert lead.patch(base + f"field-definitions/{field['id']}/", {"kind": "text"}, format="json").status_code == 400
    assert lead.delete(base + f"field-definitions/{field['id']}/").status_code == 204
    data = member.get(url).json()
    assert data["values"][field["id"]] == str(lab["reviewer"].id)
    assert data["fields"][0]["archived"] is True
    assert member.patch(url, {"values": {field["id"]: None}}, format="json").status_code == 400


def test_task_table_and_csv_never_expose_inaccessible_tasks(laboratory):
    lab = laboratory
    issue = Issue(workspace=lab["workspace"], project=lab["project"], name="=secret")
    issue.save(created_by_id=lab["lead"].id)
    member = lab["client"](lab["member"])
    data = member.get(lab["base"] + "task-table/").json()
    assert data["tasks"][0]["id"] == str(issue.id)
    csv = member.get(lab["base"] + "task-table/?format=csv")
    assert "'=secret" in csv.content.decode()
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    assert member.get(lab["base"] + "task-table/").json()["tasks"] == []
    assert member.get(lab["base"] + f"tasks/{issue.id}/field-values/").status_code == 404
