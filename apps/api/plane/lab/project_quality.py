# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Project plans and version-bound development, test and delivery evidence."""

import json
import hashlib
import uuid
from html import escape

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from plane.db.models import Page, PageVersion, Project, ProjectPage
from .auth import audit, lock
from .documents import page_access, accessible_pages
from .management_models import ProjectManagementRecord, latest_records
from .planning_views import LabView
from .project_budgets import BudgetConflict, text_field
from .project_management import append_record, day, employee, get_previous, identifier, membership, record_data, members

ARTIFACTS = {
    "research-report": ("plan", "研究／研制报告", ("研究目标", "技术路径", "研究／研制过程", "成果与结论")),
    "requirements": ("development", "需求规格说明", ("目标与范围", "功能需求", "性能与约束", "验收条件")),
    "development-plan": ("development", "开发计划", ("开发目标", "成员与分工", "里程碑与排期", "风险与措施")),
    "development-doc": ("development", "开发文档", ("总体设计", "接口与数据", "实现说明", "版本与变更")),
    "test-outline": ("testing", "测试大纲", ("测试范围", "测试环境", "测试策略", "通过标准")),
    "test-specification": ("testing", "测试说明", ("测试条件", "测试用例", "操作步骤", "预期结果")),
    "test-report": ("testing", "测试报告", ("测试执行", "实际结果", "缺陷与复测", "测试结论")),
    "outcomes": ("delivery", "数据／软件／硬件成果", ("成果清单", "版本与配置", "交付内容", "存放位置")),
    "summary": ("delivery", "总结报告", ("目标完成情况", "成果与指标", "问题与经验", "后续建议")),
    "manual": ("delivery", "使用说明书", ("安装与配置", "操作说明", "维护方法", "常见问题")),
    "certificate": ("delivery", "合格证", ("成果标识", "适用标准", "检验记录", "合格结论")),
}
PLAN_SECTIONS = ("项目目标与要求", "成员与分工", "里程碑与排期", "技术路径")


def may_review(user, project, member):
    from plane.db.models import WorkspaceMember

    return (
        member.role == 20
        or user.id in (project.created_by_id, project.project_lead_id)
        or WorkspaceMember.objects.filter(workspace=project.workspace, member=user, role=20, is_active=True).exists()
    )


def page_fingerprint(page):
    value = json.dumps(
        [page.name, page.description_html, page.description_json], sort_keys=True, ensure_ascii=False
    ).encode()
    return hashlib.sha256(value + bytes(page.description_binary or b"")).hexdigest()


def current_document(row, project, user):
    page_id = row.data.get("page_id")
    if not page_id:
        return False
    page = (
        accessible_pages(user, project.workspace, project.id)
        .filter(id=page_id, archived_at__isnull=True, access=Page.PUBLIC_ACCESS)
        .first()
    )
    if not page:
        return False
    version = PageVersion.objects.filter(page=page).order_by("-created_at", "-id").first()
    return bool(
        version
        and str(version.id) == row.data.get("page_version_id")
        and page_fingerprint(page) == row.data.get("page_hash")
    )


def quality_record(row, project, user):
    result = record_data(row)
    result["document_current"] = current_document(row, project, user)
    page = accessible_pages(user, project.workspace, project.id).filter(
        id=row.data.get("page_id"), archived_at__isnull=True, access=Page.PUBLIC_ACCESS
    ).first() if row.data.get("page_id") else None
    result["document_status"] = "current" if result["document_current"] else "updated" if page else "unavailable"
    bound = PageVersion.objects.filter(page=page, id=row.data.get("page_version_id")).first() if page else None
    current = PageVersion.objects.filter(page=page).order_by("-created_at", "-id").first() if page else None
    result["document_version_at"] = bound.created_at.isoformat() if bound else None
    result["current_document_version_at"] = current.created_at.isoformat() if current else None
    if not result["document_current"]:
        result["data"] = {**result["data"], "page_name": ""}
    return result


def shared_page(user, project, page_id, editing=False):
    page, _ = page_access(user, project.workspace, project.id, page_id, edit=editing)
    page = get_object_or_404(Page.objects.select_for_update(of=("self",), no_key=True), id=page.id)
    if page.access != Page.PUBLIC_ACCESS or page.archived_at:
        raise ValidationError("质量资料请选择项目共享且未归档的文档")
    return page


def snapshot_document(user, project, page):
    version = PageVersion.objects.filter(page=page).order_by("-created_at", "-id").first()
    if not version or (
        version.description_html,
        version.description_json,
        bytes(version.description_binary or b""),
    ) != (page.description_html, page.description_json, bytes(page.description_binary or b"")):
        if page.is_locked:
            raise ValidationError("锁定文档的当前内容尚无对应版本，请先保存文档版本")
        version = PageVersion.objects.create(
            workspace=project.workspace,
            page=page,
            owned_by=user,
            description_html=page.description_html,
            description_json=page.description_json,
            description_binary=page.description_binary,
        )
    return version


def template_document(user, project, kind, data, previous):
    text = text_field(data.get("content", ""), "文档内容", 60000)
    if not text:
        raise ValidationError("请填写文档内容，或关联已有项目文档")
    title = text_field(data.get("title"), "资料名称", 255, required=True)
    html = "".join(f"<p>{escape(line)}</p>" for line in text.splitlines())
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": line}]} if line else {"type": "paragraph"}
            for line in text.splitlines()
        ],
    }
    page = None
    if previous and previous.data.get("page_id"):
        page = shared_page(user, project, previous.data["page_id"], editing=True)
        if PageVersion.objects.filter(page=page, lab_file__isnull=False).exists():
            # Preserve uploaded originals; text editing must not silently replace a file-backed document.
            raise ValidationError("上传的资料请通过文档版本更新，再重新关联")
        if page.description_binary:
            if kind != "plan":
                raise ValidationError("资料已在文档编辑器中更新，请打开文档编辑后重新关联")
            # Keep the collaboratively edited plan intact when regenerating structured assignments.
            page = None
    if page:
        page.name = title
        page.description_html = html
        page.description_json = content
        page.save(update_fields=["name", "description_html", "description_json", "updated_at"])
    else:
        page = Page.objects.create(
            workspace=project.workspace,
            owned_by=user,
            name=title,
            access=Page.PUBLIC_ACCESS,
            description_html=html,
            description_json=content,
        )
        ProjectPage.objects.create(workspace=project.workspace, project=project, page=page)
    version = PageVersion.objects.create(
        workspace=project.workspace, page=page, owned_by=user, description_html=html, description_json=content
    )
    return page, version, text


def normalize_plan(project, data):
    assignments = data.get("assignments", [])
    if not isinstance(assignments, list) or not 1 <= len(assignments) <= 100:
        raise ValidationError("请填写1至100项成员分工")
    result = []
    for entry in assignments:
        if not isinstance(entry, dict):
            raise ValidationError("成员分工格式无效")
        user_id, name = employee(project, entry.get("user_id"))
        start, end = day(entry.get("start"), "分工开始日期"), day(entry.get("end"), "分工结束日期")
        if start > end:
            raise ValidationError("分工开始日期不能晚于结束日期")
        result.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "user_name": name,
                "start": start,
                "end": end,
                "work": text_field(entry.get("work"), "成员职责与分工", 2000, required=True),
            }
        )
    return {
        "assignments": result,
        "requirements": text_field(data.get("requirements"), "项目要求", 10000, required=True),
        "technical_route": text_field(data.get("technical_route"), "技术路径", 10000, required=True),
    }


@transaction.atomic
def quality_mutation(user, project, body):
    lock(f"quality:{project.id}")
    project = get_object_or_404(Project.objects.select_for_update(of=("self",), no_key=True), id=project.id)
    member = membership(user, project)
    if project.archived_at:
        raise ValidationError("归档项目不能修改质量资料")
    if not isinstance(body, dict):
        raise ValidationError("请求须为对象")
    if body.get("kind") not in ("plan", "artifact"):
        raise ValidationError("资料类型无效")
    key = identifier(body.get("request_key"), "请求标识")
    old_request = ProjectManagementRecord.objects.filter(workspace=project.workspace, request_key=key).first()
    if old_request:
        if (
            old_request.actor_id != user.id
            or old_request.project_id_snapshot != project.id
            or old_request.request_snapshot != body
        ):
            raise BudgetConflict("请求标识已被使用")
        return old_request
    kind = body.get("kind")
    if kind not in ("plan", "artifact"):
        raise ValidationError("资料类型无效")
    record_key, previous = get_previous(project, body, kind)
    data = body.get("data", {})
    if not isinstance(data, dict):
        raise ValidationError("资料内容须为对象")
    action = body.get("action")
    if action == "save":
        if previous and previous.state == "submitted":
            raise ValidationError("请先撤回待审资料再编辑")
        if kind == "plan" and record_key != uuid.uuid5(project.id, "plan"):
            raise ValidationError("项目计划标识无效")
        category = "project-plan" if kind == "plan" else data.get("category")
        if kind == "artifact" and (not isinstance(category, str) or category not in ARTIFACTS):
            raise ValidationError("资料类别无效")
        if previous and previous.data["category"] != category:
            raise ValidationError("不能改变已有资料类别")
        payload = normalize_plan(project, data) if kind == "plan" else {}
        payload.update(
            {
                "category": category,
                "title": text_field(data.get("title"), "资料名称", 255, required=True),
                "content": text_field(data.get("content", ""), "文档内容", 60000),
            }
        )
        if data.get("page_id"):
            page = shared_page(user, project, identifier(data["page_id"], "文档ID"))
            version = snapshot_document(user, project, page)
            if not version:
                raise ValidationError("关联文档没有可用版本")
            payload["content"] = ""
        else:
            full = dict(data)
            if kind == "plan":
                full["content"] = "\n".join(
                    [
                        "项目要求",
                        payload["requirements"],
                        "技术路径",
                        payload["technical_route"],
                        "成员分工与排期",
                        *[
                            f"{row['user_name']}：{row['work']}（{row['start']} 至 {row['end']}）"
                            for row in payload["assignments"]
                        ],
                    ]
                )
            page, version, content = template_document(user, project, kind, full, previous)
            payload["content"] = content
        payload.update(
            page_id=str(page.id), page_version_id=str(version.id), page_name=page.name, page_hash=page_fingerprint(page)
        )
        state = "draft"
    elif action in ("submit", "withdraw", "review"):
        if not previous:
            raise ValidationError("资料不存在")
        payload = dict(previous.data)
        if action == "submit":
            if previous.state not in ("draft", "rejected", "approved"):
                raise ValidationError("当前资料不能提交评审")
            page = shared_page(user, project, payload["page_id"])
            version = snapshot_document(user, project, page)
            if not version:
                raise ValidationError("资料没有可用版本")
            payload.update(page_version_id=str(version.id), page_name=page.name, page_hash=page_fingerprint(page))
            payload.update(submitted_by=user.display_name, submitted_at=timezone.now().isoformat())
            state = "submitted"
        elif action == "withdraw":
            if previous.state != "submitted":
                raise ValidationError("只能撤回待审资料")
            state = "draft"
        else:
            if not may_review(user, project, member):
                raise PermissionDenied("仅项目管理员或负责人可评审")
            if previous.state != "submitted" or not current_document(previous, project, user):
                raise ValidationError("资料已更新或不在待审状态，请重新提交")
            state = data.get("result")
            if state not in ("approved", "rejected"):
                raise ValidationError("评审结果无效")
            payload["review_note"] = text_field(data.get("note"), "评审意见", 4000, required=True)
            payload.update(reviewed_by=user.display_name, reviewed_at=timezone.now().isoformat())
    else:
        raise ValidationError("操作无效")
    row = append_record(user, project, body, kind, record_key, previous, state, payload)
    audit("quality." + action, row, user, project.workspace, kind=kind, version=row.version, state=state)
    return row


class ProjectQualityView(LabView):
    def get(self, request, slug, pk):
        project = get_object_or_404(Project, workspace=self.workspace, id=pk)
        member = membership(request.user, project)
        rows = list(latest_records(pk).filter(kind__in=("plan", "artifact")))
        records = [quality_record(row, project, request.user) for row in rows]
        result = {
            "project_id": str(pk),
            "plan_id": str(uuid.uuid5(pk, "plan")),
            "can_edit": not bool(project.archived_at),
            "can_review": may_review(request.user, project, member),
            "members": [{"id": str(row.member_id), "name": row.member.display_name} for row in members(project)],
            "catalog": [
                {"key": key, "stage": stage, "label": label, "sections": sections}
                for key, (stage, label, sections) in ARTIFACTS.items()
            ],
            "records": records,
        }
        if request.query_params.get("record_id"):
            key = identifier(request.query_params["record_id"])
            if not any(row.object_key == key for row in rows):
                raise ValidationError("资料不存在")
            result["history"] = [
                record_data(row)
                for row in ProjectManagementRecord.objects.filter(
                    workspace=self.workspace, project_id_snapshot=pk, object_key=key
                ).order_by("-version")
            ]
        if request.query_params.get("format") == "json":
            response = HttpResponse(
                json.dumps(result, ensure_ascii=False, indent=2), content_type="application/json; charset=utf-8"
            )
            response["Content-Disposition"] = 'attachment; filename="project-quality-dossier.json"'
            return response
        return Response(result)

    def post(self, request, slug, pk):
        project = get_object_or_404(Project, workspace=self.workspace, id=pk)
        return Response(
            quality_record(quality_mutation(request.user, project, request.data), project, request.user), status=201
        )
