# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Confirm persisted AI finance drafts through the existing accounting rules."""

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from plane.db.models import Project
from .finance_models import FinancialAccount
from .finance_permissions import require_project_finance
from .models import AgentMessage
from .planning_views import LabView
from .project_management import finance_mutation, identifier, membership, record_data


@transaction.atomic
def confirm_finance_draft(user, workspace, message_id, data=None):
    """One message is one confirmation, including retries and batch payments."""
    data = data or {}
    if not isinstance(data, dict):
        raise ValidationError("确认参数须为对象")
    message = (
        AgentMessage.objects.select_for_update(of=("self",))
        .select_related("thread")
        .filter(id=identifier(message_id, "草稿ID"), thread__workspace=workspace, thread__user=user, role="assistant")
        .first()
    )
    if message is None:
        raise ValidationError("草稿不存在或不可访问")
    draft = message.draft if isinstance(message.draft, dict) else {}
    kind = draft.get("kind")
    if kind not in ("time", "payroll", "payment") or message.intent == "special":
        raise ValidationError("该消息不是可确认的财务草稿")
    # A thread may have switched projects after this message was created.
    project_id = draft.get("project_id")
    if not project_id:
        raise ValidationError("旧草稿缺少项目，请重新生成后确认")
    project = Project.objects.filter(id=identifier(project_id, "项目ID"), workspace=workspace).first()
    if project is None:
        raise ValidationError("草稿项目不存在")
    membership(user, project)
    if kind in ("payroll", "payment"):
        require_project_finance(user, project, "approve" if kind == "payroll" else "pay")
    elif str(draft.get("user_id")) != str(user.id):
        require_project_finance(user, project, "record")
    execution = draft.get("execution")
    if isinstance(execution, dict) and execution.get("status") == "executed":
        return {"message_id": str(message.id), "draft": draft, **execution}

    records = []
    if kind in ("time", "payroll"):
        if kind == "time":
            payload = {
                "category": "labor",
                "user_id": draft.get("user_id"),
                "date": draft.get("date"),
                "hours": draft.get("hours"),
                "work": draft.get("work"),
                "rate": draft.get("rate") or str(data.get("rate", "")).strip(),
            }
        else:
            payload = {key: draft.get(key) for key in ("user_id", "start", "end")}
        row = finance_mutation(
            user,
            project,
            {
                "kind": "cost" if kind == "time" else "payroll",
                "action": "save",
                "request_key": str(uuid.uuid5(message.id, "confirm")),
                "record_id": str(uuid.uuid5(message.id, "record")),
                "expected_version": 0,
                "reason": "确认 AI 工时草稿" if kind == "time" else "确认 AI 工资草稿",
                "data": payload,
            },
        )
        records.append(record_data(row))
    else:
        pending = draft.get("records")
        record_kind = draft.get("kind_label")
        if record_kind not in ("cost", "payroll") or not isinstance(pending, list) or not 1 <= len(pending) <= 50:
            raise ValidationError("支付草稿无效，请重新生成")
        account_id = data.get("account_id")
        if not account_id:
            account_id = (
                FinancialAccount.objects.filter(workspace=workspace, project_id_snapshot=project.id, kind="project")
                .values_list("id", flat=True)
                .first()
            )
        if not account_id:
            raise ValidationError("没有可用的项目资金账户")
        seen = set()
        for item in pending:
            if not isinstance(item, dict):
                raise ValidationError("支付记录无效")
            record_id = identifier(item.get("id"))
            if record_id in seen:
                raise ValidationError("支付草稿包含重复记录")
            seen.add(record_id)
            row = finance_mutation(
                user,
                project,
                {
                    "kind": record_kind,
                    "action": "pay",
                    "record_id": str(record_id),
                    "expected_version": item.get("version"),
                    "request_key": str(uuid.uuid5(message.id, f"pay:{record_id}")),
                    "reason": "确认 AI 支付草稿",
                    "data": {
                        "account_id": str(account_id),
                        "expected_amount": item.get("amount"),
                        "reference": f"AI-{message.id}-{record_id}",
                        "evidence": "用户在 AI 会话中确认登记支付",
                    },
                },
            )
            records.append(record_data(row))
    execution = {"status": "executed", "records": records, "executed_at": timezone.now().isoformat()}
    message.draft = {**draft, "execution": execution}
    message.save(update_fields=["draft"])
    return {"message_id": str(message.id), "draft": message.draft, **execution}


class AgentMessageConfirmView(LabView):
    def post(self, request, slug, pk):
        return Response(confirm_finance_draft(request.user, self.workspace, pk, request.data))
