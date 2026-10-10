# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Page, PageVersion, ProjectMember, ProjectPage
from .auth import audit, lock
from .document_models import TaskDocumentLink
from .document_files import file_data, files_for_pages
from .permissions import issue_access, readable_issues
from .planning_views import LabView


EXPERIMENT_SECTIONS = ("目标", "方法", "配置", "结果", "结论", "后续事项")
EXPERIMENT_HTML = "".join(f"<h2>{title}</h2><p></p>" for title in EXPERIMENT_SECTIONS)
EXPERIMENT_JSON = {
    "type": "doc",
    "content": [
        node
        for title in EXPERIMENT_SECTIONS
        for node in (
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": title}]},
            {"type": "paragraph"},
        )
    ],
}


def project_membership(user, workspace, project_id, edit=False):
    membership = get_object_or_404(
        ProjectMember.objects.select_related("project"),
        workspace=workspace,
        project_id=project_id,
        project__deleted_at__isnull=True,
        project__archived_at__isnull=True,
        member=user,
        is_active=True,
    )
    if edit and membership.role < 15:
        raise PermissionDenied("需要项目成员编辑权限")
    if membership.role == 5 and not membership.project.guest_view_all_features:
        raise PermissionDenied("访客没有项目文档访问权限")
    return membership


def accessible_pages(user, workspace, project_id):
    return (
        Page.objects.filter(
            workspace=workspace,
            project_pages__project_id=project_id,
            project_pages__deleted_at__isnull=True,
        )
        .filter(Q(access=Page.PUBLIC_ACCESS) | Q(owned_by=user))
        .distinct()
    )


def page_access(user, workspace, project_id, page_id, edit=False):
    membership = project_membership(user, workspace, project_id, edit=edit)
    page = get_object_or_404(accessible_pages(user, workspace, project_id), id=page_id)
    if edit and (page.is_locked or page.archived_at):
        raise ValidationError("锁定或归档文档不能修改关联")
    return page, membership


def document_data(page, project_id, document_files=None):
    document_files = files_for_pages([page]) if document_files is None else document_files
    return {
        "id": str(page.id),
        "name": page.name or "未命名文档",
        "project_id": str(project_id),
        "access": page.access,
        "owned_by": str(page.owned_by_id),
        "is_locked": page.is_locked,
        "archived_at": page.archived_at.isoformat() if page.archived_at else None,
        "updated_at": page.updated_at.isoformat(),
        "file": file_data(document_files.get(page.id), project_id),
    }


class ProjectDocumentsView(LabView):
    def get(self, request, slug, project_id):
        membership = project_membership(request.user, self.workspace, project_id)
        pages = accessible_pages(request.user, self.workspace, project_id).filter(archived_at__isnull=True)
        query = str(request.query_params.get("q", "")).strip()[:100]
        if query:
            pages = pages.filter(name__icontains=query)
        pages = list(pages.order_by("-updated_at")[:100])
        document_files = files_for_pages(pages)
        return Response(
            {
                "documents": [document_data(page, project_id, document_files) for page in pages],
                "can_edit": membership.role >= 15,
            }
        )

    @transaction.atomic
    def post(self, request, slug, project_id):
        project_membership(request.user, self.workspace, project_id, edit=True)
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 255:
            raise ValidationError("文档名称为 1–255 字")
        access = request.data.get("access", Page.PUBLIC_ACCESS)
        if isinstance(access, bool) or access not in (Page.PUBLIC_ACCESS, Page.PRIVATE_ACCESS):
            raise ValidationError("请选择公开或私人文档")
        issue = None
        if request.data.get("issue_id"):
            issue = issue_access(request.user, self.workspace, request.data["issue_id"], edit=True)
            if str(issue.project_id) != str(project_id):
                raise ValidationError("任务与文档必须属于同一项目")
        page = Page.objects.create(
            workspace=self.workspace,
            owned_by=request.user,
            name=name,
            access=access,
            description_html=EXPERIMENT_HTML,
            description_json=EXPERIMENT_JSON,
        )
        ProjectPage.objects.create(workspace=self.workspace, project_id=project_id, page=page)
        PageVersion.objects.create(
            workspace=self.workspace,
            page=page,
            owned_by=request.user,
            description_html=EXPERIMENT_HTML,
            description_json=EXPERIMENT_JSON,
        )
        if issue:
            TaskDocumentLink.objects.create(workspace=self.workspace, issue=issue, page=page)
        audit("document.experiment_created", page, request.user, self.workspace, project_id=str(project_id))
        return Response(document_data(page, project_id), status=201)


class TaskDocumentsView(LabView):
    def get(self, request, slug, issue_id):
        issue = issue_access(request.user, self.workspace, issue_id)
        membership = project_membership(request.user, self.workspace, issue.project_id)
        pages = accessible_pages(request.user, self.workspace, issue.project_id).filter(
            lab_tasks__issue=issue, lab_tasks__deleted_at__isnull=True
        )
        pages = list(pages)
        document_files = files_for_pages(pages)
        return Response(
            {
                "documents": [document_data(page, issue.project_id, document_files) for page in pages],
                "can_edit": membership.role >= 15 and not issue.archived_at,
            }
        )


class DocumentTasksView(LabView):
    def get(self, request, slug, page_id):
        project_id = request.query_params.get("project_id")
        if not project_id:
            raise ValidationError("需要项目 ID")
        page, membership = page_access(request.user, self.workspace, project_id, page_id)
        issues = readable_issues(request.user, self.workspace).filter(
            project_id=project_id,
            is_draft=False,
            lab_documents__page=page,
            lab_documents__deleted_at__isnull=True,
        )
        return Response(
            {
                "tasks": [
                    {
                        "id": str(issue.id),
                        "title": issue.name,
                        "project_id": str(issue.project_id),
                        "key": f"{membership.project.identifier}-{issue.sequence_id}",
                    }
                    for issue in issues
                ],
                "can_edit": membership.role >= 15 and not page.archived_at and not page.is_locked,
            }
        )

    @transaction.atomic
    def post(self, request, slug, page_id):
        issue = issue_access(request.user, self.workspace, request.data.get("issue_id"), edit=True)
        page, _ = page_access(request.user, self.workspace, issue.project_id, page_id, edit=True)
        lock(f"lab-document:{issue.id}:{page.id}")
        link, created = TaskDocumentLink.objects.get_or_create(workspace=self.workspace, issue=issue, page=page)
        if created:
            audit("document.linked", link, request.user, self.workspace, page_id=str(page.id), issue_id=str(issue.id))
        return Response({"id": str(link.id)}, status=201 if created else 200)

    @transaction.atomic
    def delete(self, request, slug, page_id):
        issue = issue_access(request.user, self.workspace, request.data.get("issue_id"), edit=True)
        page, _ = page_access(request.user, self.workspace, issue.project_id, page_id, edit=True)
        lock(f"lab-document:{issue.id}:{page.id}")
        link = TaskDocumentLink.objects.filter(workspace=self.workspace, issue=issue, page=page).first()
        if link:
            audit("document.unlinked", link, request.user, self.workspace, page_id=str(page.id), issue_id=str(issue.id))
            TaskDocumentLink.objects.filter(id=link.id).delete()
        return Response(status=204)
