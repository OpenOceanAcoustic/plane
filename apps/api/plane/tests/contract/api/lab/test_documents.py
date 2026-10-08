# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections

from plane.db.models import Issue, Page, PageVersion, Project, ProjectMember, ProjectPage, WorkspaceMember

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


def issue(lab, name="实验任务"):
    return Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name=name, state=lab["states"]["todo"]
    )


def test_template_uses_native_page_and_explicit_bidirectional_links(laboratory):
    from plane.lab.document_models import TaskDocumentLink

    lab = laboratory
    client = lab["client"](lab["member"])
    task = issue(lab)
    response = client.post(
        lab["base"] + f"projects/{lab['project'].id}/documents/",
        {"name": "海洋声学实验", "issue_id": str(task.id), "access": 0},
        format="json",
    )
    assert response.status_code == 201
    page = Page.objects.get(id=response.json()["id"])
    assert page.owned_by == lab["member"]
    assert ProjectPage.objects.filter(project=lab["project"], page=page).exists()
    assert PageVersion.objects.filter(page=page).exists()
    for heading in ("目标", "方法", "配置", "结果", "结论", "后续事项"):
        assert heading in page.description_html
    assert client.get(lab["base"] + f"tasks/{task.id}/documents/").json()["documents"][0]["id"] == str(page.id)
    assert client.get(lab["base"] + f"documents/{page.id}/tasks/?project_id={lab['project'].id}").json()["tasks"][0][
        "id"
    ] == str(task.id)
    assert (
        client.post(lab["base"] + f"documents/{page.id}/tasks/", {"issue_id": str(task.id)}, format="json").status_code
        == 200
    )
    assert TaskDocumentLink.objects.filter(issue=task, page=page).count() == 1
    assert (
        client.delete(
            lab["base"] + f"documents/{page.id}/tasks/", {"issue_id": str(task.id)}, format="json"
        ).status_code
        == 204
    )
    assert Page.objects.filter(id=page.id).exists()
    assert not TaskDocumentLink.objects.filter(issue=task, page=page).exists()
    assert (
        client.post(lab["base"] + f"documents/{page.id}/tasks/", {"issue_id": str(task.id)}, format="json").status_code
        == 201
    )


def test_private_page_and_removed_project_links_never_leak(laboratory):
    lab = laboratory
    member = lab["client"](lab["member"])
    lead = lab["client"](lab["lead"])
    task = issue(lab)
    response = member.post(
        lab["base"] + f"projects/{lab['project'].id}/documents/",
        {"name": "不可泄露实验记录", "issue_id": str(task.id), "access": 1},
        format="json",
    )
    assert response.status_code == 201
    page_id = response.json()["id"]
    assert lead.get(lab["base"] + f"tasks/{task.id}/documents/").json()["documents"] == []
    assert "不可泄露" not in lead.get(lab["base"] + f"projects/{lab['project'].id}/documents/").content.decode()
    assert lead.get(lab["base"] + f"documents/{page_id}/tasks/?project_id={lab['project'].id}").status_code == 404
    native = f"/api/workspaces/lab/projects/{lab['project'].id}/pages/{page_id}/versions/"
    assert lead.get(native).status_code == 403
    ProjectPage.objects.filter(page_id=page_id).delete()
    assert member.get(lab["base"] + f"tasks/{task.id}/documents/").json()["documents"] == []
    assert member.get(native).status_code == 403


def test_cross_project_links_guests_and_revoked_memberships_are_rejected(laboratory):
    lab = laboratory
    client = lab["client"](lab["member"])
    task = issue(lab)
    other = Project.objects.create(workspace=lab["workspace"], name="另一个项目", identifier="OTHER")
    ProjectMember.objects.create(workspace=lab["workspace"], project=other, member=lab["member"], role=15)
    page = Page.objects.create(workspace=lab["workspace"], name="不同项目文档", owned_by=lab["member"])
    ProjectPage.objects.create(workspace=lab["workspace"], project=other, page=page)
    assert (
        client.post(lab["base"] + f"documents/{page.id}/tasks/", {"issue_id": str(task.id)}, format="json").status_code
        == 404
    )
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    assert (
        client.post(
            lab["base"] + f"projects/{lab['project'].id}/documents/", {"name": "Guest"}, format="json"
        ).status_code
        == 403
    )
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
    assert client.get(lab["base"] + f"projects/{lab['project'].id}/documents/").status_code == 404


def test_locked_or_archived_page_cannot_change_links(laboratory):
    lab = laboratory
    client = lab["client"](lab["member"])
    task = issue(lab)
    page = Page.objects.create(workspace=lab["workspace"], name="锁定记录", owned_by=lab["member"], is_locked=True)
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)
    assert (
        client.post(lab["base"] + f"documents/{page.id}/tasks/", {"issue_id": str(task.id)}, format="json").status_code
        == 400
    )


def test_native_versions_are_accessible_only_with_current_membership(laboratory):
    lab = laboratory
    client = lab["client"](lab["member"])
    page = client.post(
        lab["base"] + f"projects/{lab['project'].id}/documents/", {"name": "可恢复实验记录"}, format="json"
    ).json()
    version = PageVersion.objects.get(page_id=page["id"])
    base = f"/api/workspaces/lab/projects/{lab['project'].id}/pages/{page['id']}/versions/"
    assert client.get(base).status_code == 200
    detail = client.get(base + f"{version.id}/")
    assert detail.status_code == 200 and "目标" in detail.json()["description_html"]
    assert client.get(base + f"{uuid.uuid4()}/").status_code == 404
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["member"]).update(is_active=False)
    assert client.get(base).status_code == 403


def test_concurrent_manual_linking_creates_only_one_active_association(laboratory):
    from plane.lab.document_models import TaskDocumentLink

    lab = laboratory
    task = issue(lab)
    page = Page.objects.create(workspace=lab["workspace"], owned_by=lab["member"], name="并发关联")
    ProjectPage.objects.create(workspace=lab["workspace"], project=lab["project"], page=page)

    def connect(_):
        close_old_connections()
        try:
            return (
                lab["client"](lab["member"])
                .post(lab["base"] + f"documents/{page.id}/tasks/", {"issue_id": str(task.id)}, format="json")
                .status_code
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(connect, (0, 1))) == [200, 201]
    assert TaskDocumentLink.objects.filter(issue=task, page=page).count() == 1
