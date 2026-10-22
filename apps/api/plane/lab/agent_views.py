# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Server-side DeepSeek draft extractor for lab time entries.

The model only turns a sentence into a validated draft. It never writes a time
entry; the existing finance-management form remains the confirmation step.
"""

import json
import logging
import os
import re
import time
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder
from django.utils.html import escape
from openai import OpenAI
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Issue, Project, ProjectMember, State, WorkspaceMember

from .finance_permissions import require_project_finance
from .labor_hours import work_hours
from .models import AgentLeadRequest, AgentMessage, AgentProposal, AgentReminder, AgentThread
from .project_management import finance_overview
from plane.app.serializers.issue import IssueCreateSerializer
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host
from .planning_views import LabView

logger = logging.getLogger(__name__)
MAX_MESSAGE = 1000
RATE_LIMIT = 12


def _config():
    provider = str(os.environ.get("LLM_PROVIDER", "")).strip().lower()
    key = str(os.environ.get("DEEPSEEK_API_KEY", "")).strip()
    if not key and provider == "deepseek":
        key = str(os.environ.get("LLM_API_KEY", "")).strip()
    if not key:
        raise APIException(
            "AI 尚未配置：请在 API 环境变量里设置 LLM_PROVIDER=deepseek 和 LLM_API_KEY", code=503
        )
    base = (
        str(os.environ.get("DEEPSEEK_BASE_URL", "")).strip()
        or str(os.environ.get("LLM_BASE_URL", "")).strip()
        or "https://api.deepseek.com"
    )
    model = (
        str(os.environ.get("DEEPSEEK_MODEL", "")).strip()
        or (str(os.environ.get("LLM_MODEL", "")).strip() if provider == "deepseek" else "")
        or "deepseek-chat"
    )
    return key, base, model






def _notify_issue(request, issue, payload):
    try:
        issue_activity.delay(
            type="issue.activity.created",
            requested_data=json.dumps(payload, cls=DjangoJSONEncoder, ensure_ascii=False),
            actor_id=str(request.user.id),
            issue_id=str(issue.id),
            project_id=str(issue.project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
    except Exception:
        logger.warning("lab agent issue activity dispatch failed")




def _task_facts(project):
    today = timezone.localdate()
    rows = list(
        Issue.objects.filter(
            project=project,
            deleted_at__isnull=True,
            is_draft=False,
            archived_at__isnull=True,
        )
        .select_related("state")
        .prefetch_related("issue_assignee__assignee")[:300]
    )
    active = 0
    overdue = []
    unassigned = []
    for row in rows:
        group = row.state.group if row.state else ""
        if group in ("completed", "cancelled"):
            continue
        active += 1
        if not row.issue_assignee.all():
            unassigned.append(_brief_issue(row))
        if row.target_date and row.target_date < today:
            overdue.append(_brief_issue(row))
    return {
        "active": active,
        "overdue": len(overdue),
        "unassigned": len(unassigned),
        "overdue_tasks": overdue[:10],
        "unassigned_tasks": unassigned[:10],
    }


def _limit(request, action, limit=30, window=70):
    try:
        key = f"lab-agent-limit:{action}:{request.user.id}"
        used = cache.get(key, 0)
        if used >= limit:
            raise APIException("操作太频繁，请稍后再试", code=429)
        cache.set(key, used + 1, window)
    except APIException:
        raise
    except Exception:
        logger.warning("lab agent limit cache unavailable")


def _system_prompt(user, project, members, today):
    people = "、".join(f"{member.member.display_name}({member.member_id})" for member in members)
    return (
        "你是实验室项目工时登记助手。只做字段抽取，绝不执行写入。\n"
        f"当前用户：{user.display_name}\n"
        f"当前项目：{project.name}（{project.id}）\n"
        f"可登记成员：{people}\n"
        f"今天：{today.isoformat()}（Asia/Shanghai）\n"
        "只输出一个 JSON 对象，不要 Markdown。\n"
        "字段：status（draft 或 needs_input）、question、date（YYYY-MM-DD）、hours、work、user_id、rate、confidence。\n"
        "规则：\n"
        "1. date 缺省为今天；不能是未来日期，最多回溯一年。\n"
        "2. hours 用数字字符串，或天数×每日小时，例如 3、5×8；不得为 0。\n"
        "3. work 是具体工作内容，不能为空。\n"
        "4. user_id 只能从上面的成员 ID 中选择；缺省为当前用户。\n"
        "5. rate 只在用户明确说时填写（每小时金额），否则留空。\n"
        "6. 项目只能是当前项目，不能自行切换。\n"
        "7. 缺少日期、工时或工作内容且无法合理推断时，status=needs_input，question 用一句话追问。\n"
        "8. 不要输出 SQL、命令、密钥或与字段无关的内容。"
    )


def _call_deepseek(key, base, model, system, message, max_tokens=500):
    client = OpenAI(api_key=key, base_url=base, timeout=20.0, max_retries=0)
    kwargs = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": message}],
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    try:
        completion = client.chat.completions.create(**kwargs, response_format={"type": "json_object"})
    except Exception:
        try:
            completion = client.chat.completions.create(**kwargs)
        except Exception as exc:
            logger.warning("lab time agent call failed: %s", type(exc).__name__)
            raise APIException("AI 解析失败，请稍后再试", code=502)
    choices = getattr(completion, "choices", None)
    if not choices:
        raise APIException("AI 返回空结果，请稍后再试", code=502)
    content = (choices[0].message.content or "").strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
    try:
        payload = json.loads(content)
    except (TypeError, ValueError):
        raise APIException("AI 返回格式不正确，请换一种说法", code=502)
    if not isinstance(payload, dict):
        raise APIException("AI 返回格式不正确，请换一种说法", code=502)
    return payload


def _draft(user, project, members, payload, today):
    status = str(payload.get("status", "")).strip()
    if status == "needs_input":
        question = str(payload.get("question", "")).strip()[:300]
        return {
            "status": "needs_input",
            "question": question or "请补充日期、工时和工作内容。",
            "draft": None,
        }
    raw_date = str(payload.get("date", "")).strip() or today.isoformat()
    try:
        parsed_date = date.fromisoformat(raw_date)
    except ValueError:
        raise ValidationError("AI 没识别出有效日期，请写成 2026-10-21 这种格式")
    if parsed_date > today + timedelta(days=1):
        raise ValidationError("工时日期不能是未来日期")
    if parsed_date < today - timedelta(days=365):
        raise ValidationError("工时日期最多回溯一年")
    hours = str(payload.get("hours", "")).strip()
    if not hours:
        raise ValidationError("请补充工时，例如 3 或 5×8")
    try:
        work_hours(hours, parsed_date.isoformat())
    except ValidationError as exc:
        detail = exc.detail[0] if isinstance(exc.detail, list) else exc.detail
        raise ValidationError(str(detail))
    work = str(payload.get("work", "")).strip()[:1000]
    if not work:
        raise ValidationError("请补充具体工作内容")
    member_id = str(payload.get("user_id", "")).strip() or str(user.id)
    member = next((item for item in members if str(item.member_id) == member_id), None)
    if member is None:
        raise ValidationError("AI 没识别到项目成员，请直接选择登记对象")
    rate = str(payload.get("rate", "")).strip()
    if rate:
        if not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", rate):
            raise ValidationError("时薪格式不正确")
        try:
            if Decimal(rate) <= 0:
                raise InvalidOperation
        except InvalidOperation:
            raise ValidationError("时薪必须大于 0")
    confidence = payload.get("confidence", 0)
    try:
        confidence = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "status": "draft",
        "question": "",
        "draft": {
            "project_id": str(project.id),
            "project_name": project.name,
            "date": parsed_date.isoformat(),
            "hours": hours,
            "work": work,
            "user_id": str(member.member_id),
            "user_name": member.member.display_name,
            "rate": rate,
            "confidence": confidence,
        },
    }


class TimeAgentView(LabView):
    def post(self, request, slug):
        try:
            return self._post(request, slug)
        except (APIException, PermissionDenied, ValidationError):
            raise
        except Exception as exc:
            logger.exception("lab time agent unexpected failure")
            raise APIException(f"AI 服务内部错误：{type(exc).__name__}", code=500)

    def _post(self, request, slug):
        message = str(request.data.get("message", "")).strip()
        if not message:
            raise ValidationError("请用一句话描述工时")
        if len(message) > MAX_MESSAGE:
            raise ValidationError("描述过长，请控制在 1000 字以内")
        thread_id = str(request.data.get("thread_id", "")).strip()
        thread = None
        if thread_id:
            thread = AgentThread.objects.filter(
                id=thread_id, workspace=self.workspace, user=request.user
            ).first()
            if thread is None:
                raise ValidationError("会话不存在或已失效")
        project_id = str(request.data.get("project_id", "")).strip()
        if not project_id and thread is not None and thread.project_id:
            project_id = str(thread.project_id)
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以登记工时")
        require_project_finance(request.user, project, "record")
        bucket = int(time.time() // 60)
        cache_key = f"lab-time-agent:{request.user.id}:{bucket}"
        try:
            used = cache.get(cache_key, 0)
            if used >= RATE_LIMIT:
                raise APIException("AI 请求太频繁，请一分钟后再试", code=429)
            cache.set(cache_key, used + 1, 70)
        except APIException:
            raise
        except Exception:
            logger.warning("lab time agent rate limit cache unavailable")
        members = list(
            ProjectMember.objects.filter(
                project=project,
                workspace_id=self.workspace.id,
                is_active=True,
                role__gte=15,
                member__is_active=True,
            ).select_related("member")[:200]
        )
        today = timezone.localdate()
        key, base, model = _config()
        payload = _call_deepseek(
            key,
            base,
            model,
            _system_prompt(request.user, project, members, today),
            message,
        )
        result = _draft(request.user, project, members, payload, today)
        result["provider"] = "deepseek"
        result["model"] = model
        return Response(result)


class TimeAgentHealthView(LabView):
    def get(self, request, slug):
        configured, detail, model = False, "", ""
        try:
            _key, _base, model = _config()
            configured = True
        except APIException as exc:
            detail = str(exc.detail)
        cache_ok = True
        try:
            cache.set("lab-time-agent:health", 1, 10)
            cache.get("lab-time-agent:health")
        except Exception:
            cache_ok = False
        return Response(
            {
                "configured": configured,
                "provider": str(os.environ.get("LLM_PROVIDER", "")),
                "model": model,
                "cache": cache_ok,
                "detail": detail,
            }
        )


def _chat_prompt(user, project, members, context, history, today):
    people = "、".join(f"{member.member.display_name}({member.member_id})" for member in members)
    project_text = f"{project.name}（{project.id}）" if project else "未选择项目"
    return (
        "你是实验室工作台的统一 AI 助手。只做理解、查询和草稿，绝不执行写入。\n"
        f"当前用户：{user.display_name}\n"
        f"当前项目：{project_text}\n"
        f"项目成员：{people or '无'}\n"
        f"今天：{today.isoformat()}（Asia/Shanghai）\n"
        f"页面上下文：{json.dumps(context, ensure_ascii=False)[:4000]}\n"
        f"最近对话：{json.dumps(history, ensure_ascii=False)[:4000]}\n"
        "只输出一个 JSON 对象，不要 Markdown。字段：\n"
        "intent: time_entry | project_issue | project_plan | work_item | receipt | payroll | quality | participation | query | unsupported | needs_input\n"
        "reply: 给用户看的中文回复\n"
        "question: 需要补充信息时的问题\n"
        "time: {date, hours, work, user_id, rate}（intent=time_entry 时）\n"
        "project_issue: {title, description, assignee_id, due_date, priority, acceptance}（intent=project_issue 时，发布到项目任务）\n"
        "project_plan: {summary, stages:[{title, description, start_date, target_date, tasks:[{title, description, assignee_id, due_date, priority, acceptance}]}], risks:[], assumptions:[]}（intent=project_plan 时）\n"
        "project_lead: {target_user_id, reason}（intent=project_lead 时，只生成负责人变更草稿）\n"
        "project_create: {name, start_date, target_date, all_members, member_ids, budget, description}（intent=project_create 时，只生成新建项目草稿）\n"
        "work_item: {title, description}（intent=work_item 时，只写个人规划）\n"
        "receipt: {gross, tax, management_fee, source, stage_id}（intent=receipt 时，金额为字符串）\n"
        "payroll: {user_id, start, end}（intent=payroll 时，日期 YYYY-MM-DD）\n"
        "quality: {title, description}（intent=quality 时）\n"
        "participation: {action, user_id, note}（intent=participation 时，action=invite 或 permission）\n"
        "规则：\n"
        "1. 工时：date 缺省今天；hours 用 3 或 5×8；work 必填；user_id 只能从项目成员选；rate 只在用户明确说时填。\n"
        "2. 项目工作项：任务要发布到当前项目时用 project_issue；assignee_id 只能从项目成员选；due_date 为 YYYY-MM-DD；priority 为 urgent/high/medium/low/none；acceptance 为验收标准。只生成草稿，用户确认后才发布。\n"
        "2a. 个人工作项：只在用户明确说“记到我的规划/提醒我”时用 work_item，不猜负责人和截止日期。\n"
        "2b. 项目拆解：用户给出目标/期限/团队/约束时用 project_plan，生成阶段、任务树、依赖、风险；负责人只能从项目成员选；日期 YYYY-MM-DD；最多 8 个阶段、40 个任务；只生成草稿，用户确认后才导入项目。\n"
        "2c. 项目负责人：用户说“项目负责人/负责人给某人”时用 project_lead，只生成变更草稿；必须由项目管理员审核，绝不能当任务负责人或 project_issue 处理。\n"
        "2d. 新建项目：用户要新建项目时用 project_create；不受当前项目限制；日期 YYYY-MM-DD；all_members=true 表示全部工作区成员；budget 是数字字符串；只生成草稿，用户去创建表单确认。\n"
        "3. 查询：优先依据页面上下文和 project_facts；如果 project_facts.tasks 有逾期/无人负责明细，必须列出具体工作项编号和标题，不要回答“当前页面没有这个数据”；确实没有才说明缺少数据。\n"
        "4. 入账、工资、质量、成员参与可以生成草稿，但绝不执行付款、审批、加人或改权限；草稿必须由用户进入原表单确认。\n"
        "4a. 直接付款、审批通过、删除、冲正：intent=unsupported。\n"
        "5. 缺少必要信息时用 needs_input 追问。\n"
        "6. 结合最近对话理解“改成、再加、给他也记一笔”等指代；但每个字段仍要重新校验，不能沿用已失效的数据。\n"
        "7. 入账：gross 必填且大于 0；tax/management_fee 默认 0；source 必填；stage_id 只在用户明确指阶段时填。\n"
        "8. 工资：只抽成员和计薪起止日期，不猜金额；金额由工资单按已核准工时计算。\n"
        "9. 质量：只生成标题和说明草稿，不写质量记录。\n"
        "10. 成员参与：只生成邀请/授权草稿，不自动加人。\n"
        "11. 项目工作项和项目计划都不自动发布/导入，必须等用户点确认。\n"
        "12. 不输出 SQL、命令、密钥或与字段无关的内容。"
    )


class AgentChatView(LabView):
    def post(self, request, slug):
        try:
            return self._post(request, slug)
        except (APIException, PermissionDenied, ValidationError):
            raise
        except Exception as exc:
            logger.exception("lab agent chat unexpected failure")
            raise APIException(f"AI 服务内部错误：{type(exc).__name__}", code=500)

    def _post(self, request, slug):
        message = str(request.data.get("message", "")).strip()
        if not message:
            raise ValidationError("请输入要办理的事情")
        if len(message) > MAX_MESSAGE:
            raise ValidationError("描述过长，请控制在 1000 字以内")
        thread = None
        thread_id = str(request.data.get("thread_id", "")).strip()
        if thread_id:
            thread = AgentThread.objects.filter(
                id=thread_id, workspace=self.workspace, user=request.user
            ).select_related("project").first()
            if thread is None:
                raise ValidationError("会话不存在")
        project_id = str(request.data.get("project_id", "")).strip()
        project = None
        members = []
        if project_id:
            project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
            if project is None:
                raise ValidationError("项目不存在")
            if not ProjectMember.objects.filter(
                project=project,
                workspace_id=self.workspace.id,
                member=request.user,
                is_active=True,
                role__gte=15,
                member__is_active=True,
            ).exists():
                raise PermissionDenied("只有项目成员可以使用项目 AI")
            members = list(
                ProjectMember.objects.filter(
                    project=project,
                    workspace_id=self.workspace.id,
                    is_active=True,
                    role__gte=15,
                    member__is_active=True,
                ).select_related("member")[:200]
            )
        if thread is not None and thread.project_id and project is not None and str(thread.project_id) != str(project.id):
            raise ValidationError("会话所属项目与当前项目不一致")
        project_facts = {}
        if project is not None:
            try:
                overview = finance_overview(request.user, project)
                rows = overview.get("records", [])
                accounts = overview.get("accounts", [])
                month = timezone.localdate().strftime("%Y-%m")
                month_hours = Decimal("0")
                pending_payroll = Decimal("0")
                for row in rows:
                    data = row.get("data") or {}
                    if (
                        row.get("kind") == "cost"
                        and row.get("state") in ("approved", "paid")
                        and data.get("category") == "labor"
                        and str(data.get("date", "")).startswith(month)
                    ):
                        month_hours += Decimal(str(data.get("hours") or "0"))
                    if row.get("kind") == "payroll" and row.get("state") != "paid":
                        amount = Decimal(str(data.get("amount") or "0"))
                        paid = Decimal(str(data.get("paid_amount") or "0"))
                        pending_payroll += max(Decimal("0"), amount - paid)
                project_facts = {
                    "summary": overview.get("summary"),
                    "available": str(sum((Decimal(str(account.get("available") or "0")) for account in accounts), Decimal("0"))),
                    "month_hours": str(month_hours),
                    "pending_payroll": str(pending_payroll),
                }
            except Exception:
                logger.warning("lab agent project facts unavailable")
            try:
                project_facts["tasks"] = _task_facts(project)
            except Exception:
                logger.warning("lab agent task facts unavailable")
            project_facts["project_lead"] = {
                "id": str(project.project_lead_id) if project.project_lead_id else "",
                "name": project.project_lead.display_name if project.project_lead else "未设置",
            }
        raw_context = request.data.get("context", {})
        context = raw_context if isinstance(raw_context, dict) else {}
        context = {**context, "project_facts": project_facts}
        bucket = int(time.time() // 60)
        rate_key = f"lab-agent-chat:{request.user.id}:{bucket}"
        try:
            used = cache.get(rate_key, 0)
            if used >= RATE_LIMIT:
                raise APIException("AI 请求太频繁，请一分钟后再试", code=429)
            cache.set(rate_key, used + 1, 70)
        except APIException:
            raise
        except Exception:
            logger.warning("lab agent chat rate limit cache unavailable")
        if thread is None:
            thread = AgentThread.objects.create(
                workspace=self.workspace,
                project=project,
                user=request.user,
                title=message[:80] or "新对话",
                last_message_at=timezone.now(),
            )
        history = []
        for item in reversed(list(thread.messages.order_by("-created_at")[:8])):
            history.append({"role": item.role, "content": item.content, "draft": item.draft or None})
        AgentMessage.objects.create(thread=thread, role="user", content=message)
        if thread.project_id is None and project is not None:
            thread.project = project
        if thread.title in ("", "新对话"):
            thread.title = message[:80]
        thread.last_message_at = timezone.now()
        thread.save(update_fields=["project", "title", "last_message_at"])
        today = timezone.localdate()
        key, base, model = _config()
        payload = _call_deepseek(
            key,
            base,
            model,
            _chat_prompt(request.user, project, members, context, history, today),
            message,
            max_tokens=900,
        )
        intent = str(payload.get("intent", "unsupported")).strip()
        reply = str(payload.get("reply", "")).strip()[:2000]
        question = str(payload.get("question", "")).strip()[:300]
        draft = None
        if intent == "time_entry":
            if project is None:
                intent = "needs_input"
                reply = "请先在聊天框里选择项目，再登记工时。"
                question = "选择哪个项目？"
                draft = None
            else:
                require_project_finance(request.user, project, "record")
            if project is not None:
                time_data = payload.get("time")
                if not isinstance(time_data, dict):
                    raise ValidationError("AI 没有生成工时字段，请换一种说法")
                result = _draft(request.user, project, members, {"status": "draft", **time_data}, today)
                draft = {"kind": "time", **result["draft"]}
                reply = reply or "已生成工时草稿，请确认后填入工时表。"
        elif intent == "project_create":
            item = payload.get("project_create")
            if not isinstance(item, dict):
                raise ValidationError("AI 没有生成新建项目字段，请换一种说法")
            name = str(item.get("name", "")).strip()[:255]
            start_raw = str(item.get("start_date", "")).strip()
            target_raw = str(item.get("target_date", "")).strip()
            if not name:
                intent = "needs_input"
                reply = "请补充新项目名称。"
                question = "新项目叫什么？"
            elif not start_raw or not target_raw:
                intent = "needs_input"
                reply = "请补充项目起止日期。"
                question = "项目从哪天到哪天？"
            else:
                try:
                    start = date.fromisoformat(start_raw)
                    target = date.fromisoformat(target_raw)
                except ValueError:
                    raise ValidationError("项目日期格式不正确")
                if start > target:
                    raise ValidationError("项目开始日期不能晚于结束日期")
                all_members = bool(item.get("all_members"))
                workspace_members = list(
                    WorkspaceMember.objects.filter(
                        workspace=self.workspace, is_active=True, member__is_active=True
                    ).select_related("member")[:500]
                )
                member_ids = [str(value) for value in (item.get("member_ids") or []) if str(value).strip()]
                selected = [row for row in workspace_members if all_members or str(row.member_id) in member_ids]
                budget = str(item.get("budget", "")).strip()
                if budget and not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", budget):
                    raise ValidationError("项目预算格式不正确")
                draft = {
                    "kind": "project_create",
                    "name": name,
                    "start_date": start.isoformat(),
                    "target_date": target.isoformat(),
                    "all_members": all_members,
                    "member_ids": [str(row.member_id) for row in selected],
                    "member_names": [row.member.display_name for row in selected],
                    "budget": budget,
                    "description": str(item.get("description", "")).strip()[:2000],
                }
                reply = reply or "已生成新建项目草稿，请到项目创建表单确认。"
        elif intent == "project_lead":
            if project is None:
                intent = "needs_input"
                reply = "请先选择项目，再发起项目负责人变更。"
                question = "哪个项目要换负责人？"
            else:
                item = payload.get("project_lead")
                if not isinstance(item, dict):
                    raise ValidationError("AI 没有生成负责人变更字段，请换一种说法")
                target = next(
                    (row for row in members if str(row.member_id) == str(item.get("target_user_id", "")).strip()),
                    None,
                )
                if target is None:
                    intent = "needs_input"
                    reply = "请指定项目里的成员作为新负责人。"
                    question = "项目负责人改成谁？"
                elif str(project.project_lead_id or "") == str(target.member_id):
                    intent = "needs_input"
                    reply = "该成员已经是项目负责人。"
                    question = "要改成哪位成员？"
                else:
                    draft = {
                        "kind": "project_lead",
                        "target_user_id": str(target.member_id),
                        "target_name": target.member.display_name,
                        "current_lead_name": project.project_lead.display_name if project.project_lead else "未设置",
                        "reason": str(item.get("reason", "")).strip()[:2000],
                    }
                    reply = reply or "已生成项目负责人变更草稿，需项目管理员审核。"
        elif intent == "project_issue":
            if project is None:
                intent = "needs_input"
                reply = "请先选择项目，再生成项目工作项草稿。"
                question = "这个工作项属于哪个项目？"
            else:
                item = payload.get("project_issue")
                if not isinstance(item, dict):
                    raise ValidationError("AI 没有生成项目工作项字段，请换一种说法")
                title = str(item.get("title", "")).strip()[:255]
                description = str(item.get("description", "")).strip()[:4000]
                acceptance = str(item.get("acceptance", "")).strip()[:2000]
                assignee_id = str(item.get("assignee_id", "")).strip()
                member = next((row for row in members if str(row.member_id) == assignee_id), None)
                priority = str(item.get("priority", "none")).strip()
                if priority not in ("urgent", "high", "medium", "low", "none"):
                    priority = "none"
                due_raw = str(item.get("due_date", "")).strip()
                if not title:
                    intent = "needs_input"
                    reply = "请补充项目工作项标题。"
                    question = "这个工作项叫什么？"
                elif assignee_id and member is None:
                    intent = "needs_input"
                    reply = "请指定项目里的成员作为负责人。"
                    question = "这个工作项交给谁？"
                else:
                    due_date = ""
                    if due_raw:
                        try:
                            due_date = date.fromisoformat(due_raw).isoformat()
                        except ValueError:
                            raise ValidationError("工作项截止日期格式不正确")
                    draft = {
                        "kind": "project_issue",
                        "title": title,
                        "description": description,
                        "acceptance": acceptance,
                        "assignee_id": str(member.member_id) if member else "",
                        "assignee_name": member.member.display_name if member else "",
                        "due_date": due_date,
                        "priority": priority,
                    }
                    reply = reply or "已生成项目工作项草稿，请确认后发布到项目。"
        elif intent == "project_plan":
            if project is None:
                intent = "needs_input"
                reply = "请先选择项目，再生成项目拆解草稿。"
                question = "这个计划属于哪个项目？"
            else:
                plan = _clean_plan(project, members, payload.get("plan"))
                draft = {"kind": "project_plan", **plan}
                reply = reply or "已生成项目拆解草稿，请确认后导入项目。"
        elif intent == "work_item":
            item = payload.get("work_item")
            if not isinstance(item, dict):
                raise ValidationError("AI 没有生成工作项字段，请换一种说法")
            title = str(item.get("title", "")).strip()[:255]
            description = str(item.get("description", "")).strip()[:2000]
            if not title:
                intent = "needs_input"
                reply = "请补充工作项名称。"
                question = "这个工作项叫什么？"
                draft = None
            else:
                draft = {"kind": "work_item", "title": title, "description": description}
                reply = reply or "已生成工作项草稿，确认后会记录到个人规划。"
        elif intent == "receipt":
            if project is None:
                intent = "needs_input"
                reply = "请先选择项目，再生成入账草稿。"
                question = "这笔到账属于哪个项目？"
            else:
                require_project_finance(request.user, project, "record")
                item = payload.get("receipt")
                if not isinstance(item, dict):
                    raise ValidationError("AI 没有生成入账字段，请换一种说法")
                try:
                    gross = Decimal(str(item.get("gross") or "0"))
                    tax = Decimal(str(item.get("tax") or "0"))
                    fee = Decimal(str(item.get("management_fee") or "0"))
                except Exception:
                    raise ValidationError("入账金额格式不正确")
                if gross <= 0 or tax < 0 or fee < 0 or tax + fee > gross:
                    raise ValidationError("到账金额、税金或管理费不合理")
                source = str(item.get("source", "")).strip()[:255]
                if not source:
                    intent = "needs_input"
                    reply = "请补充这笔到账的来源。"
                    question = "这笔钱从哪里来？"
                else:
                    draft = {
                        "kind": "receipt",
                        "gross": f"{gross:.2f}",
                        "tax": f"{tax:.2f}",
                        "management_fee": f"{fee:.2f}",
                        "source": source,
                        "stage_id": str(item.get("stage_id", "")).strip(),
                    }
                    reply = reply or "已生成入账草稿，请确认后到入账表单提交。"
        elif intent == "payroll":
            if project is None:
                intent = "needs_input"
                reply = "请先选择项目，再生成工资草稿。"
                question = "这份工资属于哪个项目？"
            else:
                require_project_finance(request.user, project, "approve")
                item = payload.get("payroll")
                if not isinstance(item, dict):
                    raise ValidationError("AI 没有生成工资字段，请换一种说法")
                member_id = str(item.get("user_id", "")).strip()
                member = next((row for row in members if str(row.member_id) == member_id), None)
                if member is None:
                    intent = "needs_input"
                    reply = "请先指定计薪成员。"
                    question = "这份工资发给谁？"
                else:
                    try:
                        start = date.fromisoformat(str(item.get("start", "")).strip())
                        end = date.fromisoformat(str(item.get("end", "")).strip())
                    except ValueError:
                        intent = "needs_input"
                        reply = "请补充计薪开始和结束日期。"
                        question = "计薪期间是哪天到哪天？"
                    else:
                        if start > end:
                            raise ValidationError("计薪开始日期不能晚于结束日期")
                        draft = {
                            "kind": "payroll",
                            "user_id": str(member.member_id),
                            "user_name": member.member.display_name,
                            "start": start.isoformat(),
                            "end": end.isoformat(),
                        }
                        reply = reply or "已生成工资草稿，请确认后到工资单表单提交。"
        elif intent == "quality":
            item = payload.get("quality")
            if not isinstance(item, dict):
                raise ValidationError("AI 没有生成质量字段，请换一种说法")
            title = str(item.get("title", "")).strip()[:255]
            description = str(item.get("description", "")).strip()[:2000]
            if not title:
                intent = "needs_input"
                reply = "请补充质量事项标题。"
                question = "这条质量事项叫什么？"
            else:
                draft = {"kind": "quality", "title": title, "description": description}
                reply = reply or "已生成质量草稿，请到项目与质量页面确认提交。"
        elif intent == "participation":
            if project is None:
                intent = "needs_input"
                reply = "请先选择项目，再生成成员参与草稿。"
                question = "要调整哪个项目的成员？"
            else:
                require_project_finance(request.user, project, "approve")
                item = payload.get("participation")
                if not isinstance(item, dict):
                    raise ValidationError("AI 没有生成参与字段，请换一种说法")
                action = str(item.get("action", "")).strip()
                if action not in ("invite", "permission"):
                    action = "invite"
                member_id = str(item.get("user_id", "")).strip()
                member = next((row for row in members if str(row.member_id) == member_id), None)
                note = str(item.get("note", "")).strip()[:500]
                draft = {
                    "kind": "participation",
                    "action": action,
                    "user_id": str(member.member_id) if member else "",
                    "user_name": member.member.display_name if member else "",
                    "note": note,
                }
                reply = reply or "已生成成员参与草稿，请到参与管理页面人工确认。"
        elif intent == "query":
            if not reply:
                raise ValidationError("AI 没有生成回答，请换一种问法")
        elif intent == "needs_input":
            intent = "needs_input"
        else:
            intent = "unsupported"
            reply = reply or "这个动作还没接入统一助手，请使用对应页面办理。"
        AgentMessage.objects.create(
            thread=thread,
            role="assistant",
            content=reply or question or "我没有生成结果。",
            intent=intent,
            draft=draft or {},
        )
        thread.last_message_at = timezone.now()
        thread.save(update_fields=["last_message_at"])
        return Response(
            {
                "intent": intent,
                "reply": reply,
                "question": question,
                "draft": draft,
                "provider": "deepseek",
                "model": model,
                "thread_id": str(thread.id),
            }
        )


class AgentThreadsView(LabView):
    def get(self, request, slug):
        rows = AgentThread.objects.filter(workspace=self.workspace, user=request.user).select_related("project")[:30]
        return Response(
            [
                {
                    "id": str(row.id),
                    "title": row.title,
                    "project_id": str(row.project_id) if row.project_id else None,
                    "project_name": row.project.name if row.project else "",
                    "last_message_at": row.last_message_at.isoformat() if row.last_message_at else None,
                }
                for row in rows
            ]
        )


class AgentThreadDetailView(LabView):
    def get(self, request, slug, pk):
        thread = AgentThread.objects.filter(id=pk, workspace=self.workspace, user=request.user).select_related("project").first()
        if thread is None:
            raise ValidationError("会话不存在或已失效")
        return Response(
            {
                "id": str(thread.id),
                "title": thread.title,
                "project_id": str(thread.project_id) if thread.project_id else None,
                "project_name": thread.project.name if thread.project else "",
                "messages": [
                    {
                        "id": str(row.id),
                        "role": row.role,
                        "content": row.content,
                        "intent": row.intent,
                        "draft": row.draft or None,
                        "created_at": row.created_at.isoformat(),
                    }
                    for row in thread.messages.order_by("created_at", "id")
                ],
            }
        )



class AgentProjectIssueView(LabView):
    def post(self, request, slug):
        _limit(request, "project-issue", 10)
        project_id = str(request.data.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以发布工作项")
        title = str(request.data.get("title", "")).strip()[:255]
        description = str(request.data.get("description", "")).strip()[:4000]
        acceptance = str(request.data.get("acceptance", "")).strip()[:2000]
        if not title:
            raise ValidationError("工作项标题不能为空")
        assignee_id = str(request.data.get("assignee_id", "")).strip()
        if assignee_id and not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member_id=assignee_id,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise ValidationError("负责人不是当前项目成员")
        priority = str(request.data.get("priority", "none")).strip()
        if priority not in ("urgent", "high", "medium", "low", "none"):
            priority = "none"
        due_raw = str(request.data.get("due_date", "")).strip()
        due_date = None
        if due_raw:
            try:
                due_date = date.fromisoformat(due_raw).isoformat()
            except ValueError:
                raise ValidationError("截止日期格式不正确")
        description_html = f"<p>{escape(description).replace(chr(10), '<br>')}</p>"
        if acceptance:
            description_html += f"<p><strong>验收标准</strong><br>{escape(acceptance).replace(chr(10), '<br>')}</p>"
        state = (
            State.objects.filter(project_id=project.id, default=True).first()
            or State.objects.filter(project_id=project.id).first()
        )
        serializer = IssueCreateSerializer(
            data={
                "name": title,
                "description_html": description_html,
                "priority": priority,
                "target_date": due_date,
                "assignee_ids": [assignee_id] if assignee_id else [],
                **({"state_id": str(state.id)} if state else {}),
            },
            context={
                "project_id": str(project.id),
                "workspace_id": str(self.workspace.id),
                "default_assignee_id": str(project.default_assignee_id) if project.default_assignee_id else None,
            },
        )
        if not serializer.is_valid():
            raise ValidationError(serializer.errors)
        issue = serializer.save()
        issue.created_by = request.user
        issue.updated_by = request.user
        issue.save(update_fields=["created_by", "updated_by"])
        _notify_issue(
            request,
            issue,
            {
                "name": title,
                "description_html": description_html,
                "priority": priority,
                "target_date": due_date,
                "assignee_ids": [assignee_id] if assignee_id else [],
            },
        )
        key = f"{project.identifier}-{issue.sequence_id}" if issue.sequence_id else str(issue.id)
        url = f"/{slug}/projects/{project.id}/issues/{issue.id}"
        thread_id = str(request.data.get("thread_id", "")).strip()
        if thread_id:
            thread = AgentThread.objects.filter(id=thread_id, workspace=self.workspace, user=request.user).first()
            if thread is not None:
                AgentMessage.objects.create(
                    thread=thread,
                    role="assistant",
                    content=f"已发布项目工作项：{title}（{key}）",
                    intent="project_issue",
                    draft={"kind": "project_issue_created", "issue_id": str(issue.id), "key": key, "url": url},
                )
                thread.last_message_at = timezone.now()
                thread.save(update_fields=["last_message_at"])
        return Response({"id": str(issue.id), "key": key, "title": title, "url": url})


def _plan_member(members, value):
    member_id = str(value or "").strip()
    if not member_id:
        return None
    return next((row for row in members if str(row.member_id) == member_id), None)


def _clean_plan(project, members, raw):
    if not isinstance(raw, dict):
        raise ValidationError("AI 没有生成项目计划，请换一种说法")
    summary = str(raw.get("summary", "")).strip()[:1000]
    stages = raw.get("stages")
    if not isinstance(stages, list) or not stages or len(stages) > 8:
        raise ValidationError("项目计划须包含 1 至 8 个阶段")
    clean_stages = []
    total_tasks = 0
    for stage in stages:
        if not isinstance(stage, dict):
            raise ValidationError("项目阶段格式不正确")
        title = str(stage.get("title", "")).strip()[:255]
        if not title:
            raise ValidationError("项目阶段标题不能为空")
        start_raw = str(stage.get("start_date", "")).strip()
        target_raw = str(stage.get("target_date", "")).strip()
        try:
            start_date = date.fromisoformat(start_raw).isoformat() if start_raw else ""
            target_date = date.fromisoformat(target_raw).isoformat() if target_raw else ""
        except ValueError:
            raise ValidationError("项目阶段日期格式不正确")
        if start_date and target_date and start_date > target_date:
            raise ValidationError("阶段开始日期不能晚于结束日期")
        tasks_raw = stage.get("tasks", [])
        if not isinstance(tasks_raw, list):
            raise ValidationError("项目任务格式不正确")
        clean_tasks = []
        for task in tasks_raw:
            if not isinstance(task, dict):
                raise ValidationError("项目任务格式不正确")
            task_title = str(task.get("title", "")).strip()[:255]
            if not task_title:
                raise ValidationError("项目任务标题不能为空")
            assignee = _plan_member(members, task.get("assignee_id"))
            if task.get("assignee_id") and assignee is None:
                raise ValidationError("项目任务负责人不在项目成员中")
            due_raw = str(task.get("due_date", "")).strip()
            try:
                due_date = date.fromisoformat(due_raw).isoformat() if due_raw else ""
            except ValueError:
                raise ValidationError("项目任务截止日期格式不正确")
            priority = str(task.get("priority", "none")).strip()
            if priority not in ("urgent", "high", "medium", "low", "none"):
                priority = "none"
            clean_tasks.append(
                {
                    "title": task_title,
                    "description": str(task.get("description", "")).strip()[:4000],
                    "acceptance": str(task.get("acceptance", "")).strip()[:2000],
                    "assignee_id": str(assignee.member_id) if assignee else "",
                    "assignee_name": assignee.member.display_name if assignee else "",
                    "due_date": due_date,
                    "priority": priority,
                }
            )
            total_tasks += 1
            if total_tasks > 40:
                raise ValidationError("项目计划最多 40 个任务")
        clean_stages.append(
            {
                "title": title,
                "description": str(stage.get("description", "")).strip()[:4000],
                "start_date": start_date,
                "target_date": target_date,
                "tasks": clean_tasks,
            }
        )
    risks = [str(item).strip()[:500] for item in (raw.get("risks") or []) if str(item).strip()][:10]
    assumptions = [str(item).strip()[:500] for item in (raw.get("assumptions") or []) if str(item).strip()][:10]
    return {"summary": summary, "stages": clean_stages, "risks": risks, "assumptions": assumptions}


def _create_project_issue(user, workspace, project, title, description, acceptance, assignee_id, due_date, priority, parent_id=None, request=None):
    description_html = f"<p>{escape(description).replace(chr(10), '<br>')}</p>"
    if acceptance:
        description_html += f"<p><strong>验收标准</strong><br>{escape(acceptance).replace(chr(10), '<br>')}</p>"
    state = (
        State.objects.filter(project_id=project.id, default=True).first()
        or State.objects.filter(project_id=project.id).first()
    )
    data = {
        "name": title,
        "description_html": description_html,
        "priority": priority,
        "target_date": due_date or None,
        "assignee_ids": [assignee_id] if assignee_id else [],
        **({"parent_id": str(parent_id)} if parent_id else {}),
        **({"state_id": str(state.id)} if state else {}),
    }
    serializer = IssueCreateSerializer(
        data=data,
        context={
            "project_id": str(project.id),
            "workspace_id": str(workspace.id),
            "default_assignee_id": str(project.default_assignee_id) if project.default_assignee_id else None,
        },
    )
    if not serializer.is_valid():
        raise ValidationError(serializer.errors)
    issue = serializer.save()
    issue.created_by = user
    issue.updated_by = user
    issue.save(update_fields=["created_by", "updated_by"])
    if request is not None:
        _notify_issue(
            request,
            issue,
            {
                "name": title,
                "description_html": description_html,
                "priority": priority,
                "target_date": due_date,
                "assignee_ids": [assignee_id] if assignee_id else [],
                "parent_id": str(parent_id) if parent_id else None,
            },
        )
    return issue


class AgentProjectPlanView(LabView):
    def post(self, request, slug):
        _limit(request, "project-plan", 5)
        project_id = str(request.data.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        require_project_finance(request.user, project, "approve")
        members = list(
            ProjectMember.objects.filter(
                project=project,
                workspace_id=self.workspace.id,
                is_active=True,
                role__gte=15,
                member__is_active=True,
            ).select_related("member")[:200]
        )
        plan = _clean_plan(project, members, request.data.get("plan"))
        created_stages = []
        created_tasks = []
        with transaction.atomic():
            for stage in plan["stages"]:
                stage_issue = _create_project_issue(
                    request.user,
                    self.workspace,
                    project,
                    stage["title"],
                    stage["description"],
                    "",
                    "",
                    stage["target_date"] or None,
                    "none",
                    request=request,
                )
                created_stages.append({"id": str(stage_issue.id), "key": f"{project.identifier}-{stage_issue.sequence_id}"})
                for task in stage["tasks"]:
                    issue = _create_project_issue(
                        request.user,
                        self.workspace,
                        project,
                        task["title"],
                        task["description"],
                        task["acceptance"],
                        task["assignee_id"],
                        task["due_date"] or None,
                        task["priority"],
                        parent_id=stage_issue.id,
                        request=request,
                    )
                    created_tasks.append(
                        {"id": str(issue.id), "key": f"{project.identifier}-{issue.sequence_id}", "title": issue.name}
                    )
        thread_id = str(request.data.get("thread_id", "")).strip()
        if thread_id:
            thread = AgentThread.objects.filter(id=thread_id, workspace=self.workspace, user=request.user).first()
            if thread is not None:
                AgentMessage.objects.create(
                    thread=thread,
                    role="assistant",
                    content=f"已导入项目计划：{len(created_stages)} 个阶段、{len(created_tasks)} 个任务。",
                    intent="project_plan",
                    draft={"kind": "project_plan_created", "stages": created_stages, "tasks": created_tasks},
                )
                thread.last_message_at = timezone.now()
                thread.save(update_fields=["last_message_at"])
        return Response({"stages": created_stages, "tasks": created_tasks, "count": len(created_tasks)})



def _brief_issue(row):
    assignees = [item.assignee.display_name for item in row.issue_assignee.all() if item.assignee]
    return {
        "id": str(row.id),
        "key": f"{row.project.identifier}-{row.sequence_id}" if row.sequence_id else str(row.id),
        "title": row.name,
        "assignees": assignees,
        "due": row.target_date.isoformat() if row.target_date else "",
        "state": row.state.group if row.state else "",
    }


class AgentBriefView(LabView):
    def get(self, request, slug):
        _limit(request, "brief", 60)
        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以查看执行简报")
        period = "weekly" if request.query_params.get("period") == "weekly" else "daily"
        now = timezone.now()
        cutoff = now - timedelta(days=7 if period == "weekly" else 1)
        today = timezone.localdate()
        rows = list(
            Issue.objects.filter(
                project=project,
                deleted_at__isnull=True,
                is_draft=False,
                archived_at__isnull=True,
            )
            .select_related("state", "project")
            .prefetch_related("issue_assignee__assignee")[:500]
        )
        active = []
        completed = []
        overdue = []
        due_today = []
        due_next = []
        unassigned = []
        in_progress = []
        team = {}
        for row in rows:
            group = row.state.group if row.state else ""
            open_row = group not in ("completed", "cancelled")
            if group == "completed" and row.completed_at and row.completed_at >= cutoff:
                completed.append(_brief_issue(row))
            if open_row:
                active.append(_brief_issue(row))
                if group == "started":
                    in_progress.append(_brief_issue(row))
                if not row.issue_assignee.all():
                    unassigned.append(_brief_issue(row))
                if row.target_date:
                    if row.target_date < today:
                        overdue.append(_brief_issue(row))
                    elif row.target_date == today:
                        due_today.append(_brief_issue(row))
                    elif row.target_date <= today + timedelta(days=7):
                        due_next.append(_brief_issue(row))
                for item in row.issue_assignee.all():
                    if item.assignee:
                        name = item.assignee.display_name
                        team[name] = team.get(name, 0) + 1
        finance = {}
        try:
            overview = finance_overview(request.user, project)
            finance = {
                "summary": overview.get("summary"),
                "available": str(
                    sum(
                        (
                            Decimal(str(account.get("available") or "0"))
                            for account in overview.get("accounts", [])
                        ),
                        Decimal("0"),
                    )
                ),
            }
        except Exception:
            logger.warning("lab agent brief finance unavailable")
        risks = []
        if overdue:
            risks.append(f"有 {len(overdue)} 个任务已逾期")
        if unassigned:
            risks.append(f"有 {len(unassigned)} 个进行中任务无人负责")
        if finance.get("summary") and Decimal(str(finance["summary"].get("remaining") or "0")) < 0:
            risks.append("项目预算已超支")
        summary = (
            f"{'本周' if period == 'weekly' else '今日'}：完成 {len(completed)} 个，进行中 {len(in_progress)} 个，"
            f"逾期 {len(overdue)} 个，无人负责 {len(unassigned)} 个。"
        )
        return Response(
            {
                "period": period,
                "generated_at": now.isoformat(),
                "project": {"id": str(project.id), "name": project.name},
                "counts": {
                    "active": len(active),
                    "completed": len(completed),
                    "in_progress": len(in_progress),
                    "overdue": len(overdue),
                    "due_today": len(due_today),
                    "due_next": len(due_next),
                    "unassigned": len(unassigned),
                },
                "completed": completed[:20],
                "in_progress": in_progress[:20],
                "overdue": overdue[:20],
                "due_today": due_today[:20],
                "due_next": due_next[:20],
                "unassigned": unassigned[:20],
                "team": [{"name": name, "active": count} for name, count in sorted(team.items(), key=lambda item: -item[1])],
                "finance": finance,
                "risks": risks,
                "summary": summary,
            }
        )


class AgentReminderView(LabView):
    def get(self, request, slug):
        _limit(request, "reminders", 40)
        project_id = str(request.query_params.get("project_id", "")).strip()
        rows = AgentReminder.objects.filter(workspace=self.workspace, user=request.user)
        if project_id:
            rows = rows.filter(project_id=project_id)
        return Response(
            [
                {
                    "id": str(row.id),
                    "kind": row.kind,
                    "enabled": row.enabled,
                    "hour": row.hour,
                    "weekday": row.weekday,
                    "day_of_month": row.day_of_month,
                    "project_id": str(row.project_id),
                }
                for row in rows
            ]
        )

    def post(self, request, slug):
        project_id = str(request.data.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以设置提醒")
        kind = str(request.data.get("kind", "")).strip()
        if kind not in AgentReminder.KINDS:
            raise ValidationError("提醒类型无效")
        try:
            hour = int(request.data.get("hour", 9))
            weekday = int(request.data["weekday"]) if request.data.get("weekday") not in (None, "") else None
            day_of_month = (
                int(request.data["day_of_month"]) if request.data.get("day_of_month") not in (None, "") else None
            )
        except (TypeError, ValueError):
            raise ValidationError("提醒时间格式不正确")
        if not 0 <= hour <= 23:
            raise ValidationError("提醒小时须在 0 至 23 之间")
        if weekday is not None and not 1 <= weekday <= 7:
            raise ValidationError("提醒星期须在 1 至 7 之间")
        if day_of_month is not None and not 1 <= day_of_month <= 28:
            raise ValidationError("提醒日期须在 1 至 28 之间")
        if kind == "weekly_brief" and weekday is None:
            weekday = 1
        if kind == "payroll" and day_of_month is None:
            day_of_month = 25
        reminder, _created = AgentReminder.objects.update_or_create(
            workspace=self.workspace,
            project=project,
            user=request.user,
            kind=kind,
            defaults={
                "enabled": bool(request.data.get("enabled", True)),
                "hour": hour,
                "weekday": weekday,
                "day_of_month": day_of_month,
            },
        )
        return Response(
            {
                "id": str(reminder.id),
                "kind": reminder.kind,
                "enabled": reminder.enabled,
                "hour": reminder.hour,
                "weekday": reminder.weekday,
                "day_of_month": reminder.day_of_month,
                "project_id": str(reminder.project_id),
            }
        )


class AgentRetroView(LabView):
    def get(self, request, slug):
        _limit(request, "retro", 30)
        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以查看复盘")
        period = "month" if request.query_params.get("period") == "month" else "week"
        now = timezone.now()
        today = timezone.localdate()
        cutoff = now - timedelta(days=30 if period == "month" else 7)
        start_date = today - timedelta(days=30 if period == "month" else 7)
        rows = list(
            Issue.objects.filter(
                project=project,
                deleted_at__isnull=True,
                is_draft=False,
                archived_at__isnull=True,
            )
            .select_related("state", "project")
            .prefetch_related("issue_assignee__assignee")[:500]
        )
        completed = []
        cancelled = []
        rolled = []
        overdue = []
        unassigned = []
        team = {}
        for row in rows:
            group = row.state.group if row.state else ""
            if group == "completed" and row.completed_at and row.completed_at >= cutoff:
                completed.append(_brief_issue(row))
            elif group == "cancelled" and row.updated_at >= cutoff:
                cancelled.append(_brief_issue(row))
            if group not in ("completed", "cancelled"):
                if row.target_date and row.target_date < start_date:
                    rolled.append(_brief_issue(row))
                if row.target_date and row.target_date < today:
                    overdue.append(_brief_issue(row))
                if not row.issue_assignee.all():
                    unassigned.append(_brief_issue(row))
                for item in row.issue_assignee.all():
                    if item.assignee:
                        name = item.assignee.display_name
                        entry = team.setdefault(name, {"name": name, "active": 0, "completed": 0})
                        entry["active"] += 1
            elif group == "completed":
                for item in row.issue_assignee.all():
                    if item.assignee:
                        name = item.assignee.display_name
                        entry = team.setdefault(name, {"name": name, "active": 0, "completed": 0})
                        entry["completed"] += 1
        finance = {}
        try:
            overview = finance_overview(request.user, project)
            finance = {
                "summary": overview.get("summary"),
                "available": str(
                    sum(
                        (
                            Decimal(str(account.get("available") or "0"))
                            for account in overview.get("accounts", [])
                        ),
                        Decimal("0"),
                    )
                ),
            }
        except Exception:
            logger.warning("lab agent retro finance unavailable")
        suggestions = []
        if overdue:
            suggestions.append(
                {
                    "title": "处理逾期任务",
                    "description": f"复盘发现 {len(overdue)} 个逾期任务，逐条确认新截止日期或取消。",
                    "acceptance": "每个逾期任务都有明确的新日期或取消原因。",
                    "priority": "high",
                }
            )
        if unassigned:
            suggestions.append(
                {
                    "title": "明确无人负责任务",
                    "description": f"复盘发现 {len(unassigned)} 个任务无人负责，分配负责人或关闭。",
                    "acceptance": "每个进行中任务都有负责人。",
                    "priority": "high",
                }
            )
        if rolled:
            suggestions.append(
                {
                    "title": "复盘滚动任务",
                    "description": f"有 {len(rolled)} 个任务从上一周期滚动，分析阻塞原因。",
                    "acceptance": "每个滚动任务记录原因和下一步。",
                    "priority": "medium",
                }
            )
        if not completed:
            suggestions.append(
                {
                    "title": "检查本周交付阻塞",
                    "description": "本周期没有完成项，检查是否存在阻塞、需求不清或人力不足。",
                    "acceptance": "形成一条可执行的解除阻塞动作。",
                    "priority": "medium",
                }
            )
        return Response(
            {
                "period": period,
                "generated_at": now.isoformat(),
                "start_date": start_date.isoformat(),
                "project": {"id": str(project.id), "name": project.name},
                "counts": {
                    "completed": len(completed),
                    "cancelled": len(cancelled),
                    "rolled": len(rolled),
                    "overdue": len(overdue),
                    "unassigned": len(unassigned),
                },
                "completed": completed[:20],
                "cancelled": cancelled[:20],
                "rolled": rolled[:20],
                "overdue": overdue[:20],
                "unassigned": unassigned[:20],
                "team": sorted(team.values(), key=lambda item: -(item["active"] + item["completed"])),
                "finance": finance,
                "suggestions": suggestions[:5],
            }
        )


class AgentQualityView(LabView):
    def get(self, request, slug):
        _limit(request, "quality", 30)
        from .management_models import latest_records
        from .project_quality import ARTIFACTS, quality_record

        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以查看质量反馈")
        rows = list(latest_records(project.id).filter(kind__in=("plan", "artifact")))
        records = []
        categories = set()
        for row in rows:
            try:
                result = quality_record(row, project, request.user)
            except Exception:
                continue
            records.append(result)
            category = result.get("data", {}).get("category")
            if category:
                categories.add(category)
        missing = [
            {"key": key, "label": label, "stage": stage}
            for key, (stage, label, _sections) in ARTIFACTS.items()
            if key not in categories
        ]
        stale = [
            {"id": item["id"], "title": item.get("data", {}).get("title", "未命名"), "category": item.get("data", {}).get("category", "")}
            for item in records
            if not item.get("document_current")
        ]
        pending = [
            {"id": item["id"], "title": item.get("data", {}).get("title", "未命名"), "state": item.get("state", "")}
            for item in records
            if item.get("state") not in ("approved", "closed")
        ]
        suggestions = []
        if missing:
            suggestions.append(
                {
                    "title": "补齐质量资料",
                    "description": "缺少：" + "、".join(item["label"] for item in missing[:5]),
                    "acceptance": "目录中的必需资料都有当前版本。",
                }
            )
        if stale:
            suggestions.append(
                {
                    "title": "更新失效质量资料",
                    "description": "以下资料关联文档已变化：" + "、".join(item["title"] for item in stale[:5]),
                    "acceptance": "资料重新绑定当前文档版本并完成审批。",
                }
            )
        if pending:
            suggestions.append(
                {
                    "title": "推进质量资料审批",
                    "description": "以下资料尚未完成审批：" + "、".join(item["title"] for item in pending[:5]),
                    "acceptance": "资料状态为已批准。",
                }
            )
        return Response(
            {
                "project": {"id": str(project.id), "name": project.name},
                "counts": {
                    "records": len(records),
                    "current": sum(1 for item in records if item.get("document_current")),
                    "stale": len(stale),
                    "missing": len(missing),
                    "pending": len(pending),
                },
                "missing": missing[:20],
                "stale": stale[:20],
                "pending": pending[:20],
                "suggestions": suggestions[:5],
            }
        )


class AgentTeamView(LabView):
    def get(self, request, slug):
        _limit(request, "team", 30)
        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以查看团队负载")
        members = list(
            ProjectMember.objects.filter(
                project=project,
                workspace_id=self.workspace.id,
                is_active=True,
                role__gte=15,
                member__is_active=True,
            ).select_related("member")[:100]
        )
        team = {
            str(row.member_id): {
                "id": str(row.member_id),
                "name": row.member.display_name,
                "role": "admin" if row.role == 20 else "member",
                "active": 0,
                "overdue": 0,
                "completed": 0,
            }
            for row in members
        }
        today = timezone.localdate()
        rows = list(
            Issue.objects.filter(
                project=project,
                deleted_at__isnull=True,
                is_draft=False,
                archived_at__isnull=True,
            )
            .select_related("state", "project")
            .prefetch_related("issue_assignee__assignee")[:500]
        )
        unassigned = []
        for row in rows:
            group = row.state.group if row.state else ""
            if group in ("completed", "cancelled"):
                if group == "completed":
                    for item in row.issue_assignee.all():
                        if item.assignee and str(item.assignee_id) in team:
                            team[str(item.assignee_id)]["completed"] += 1
                continue
            assignees = [item for item in row.issue_assignee.all() if item.assignee]
            if not assignees:
                unassigned.append(_brief_issue(row))
                continue
            for item in assignees:
                member = team.get(str(item.assignee_id))
                if member is None:
                    continue
                member["active"] += 1
                if row.target_date and row.target_date < today:
                    member["overdue"] += 1
        values = list(team.values())
        values.sort(key=lambda item: (-item["active"], -item["overdue"], item["name"]))
        average = sum(item["active"] for item in values) / len(values) if values else 0
        overloaded = [item for item in values if item["active"] >= 5 or item["active"] > average + 2]
        underloaded = [item for item in values if item["active"] <= max(1, average - 1)] or values[-1:] if values else []
        suggestions = []
        if unassigned and values:
            target = min(values, key=lambda item: item["active"])
            suggestions.append(
                {
                    "title": "明确无人负责任务",
                    "description": f"{len(unassigned)} 个进行中任务无人负责，可优先考虑 {target['name']}（当前 {target['active']} 个进行中）。",
                    "assignee_id": target["id"],
                    "assignee_name": target["name"],
                    "acceptance": "每个进行中任务都有明确负责人。",
                }
            )
        for item in overloaded[:3]:
            suggestions.append(
                {
                    "title": f"{item['name']} 负载偏高",
                    "description": f"进行中 {item['active']} 个，逾期 {item['overdue']} 个；建议拆分或转交部分任务。",
                    "assignee_id": item["id"],
                    "assignee_name": item["name"],
                    "acceptance": "负责人负载恢复到团队平均水平或明确延期。",
                }
            )
        if underloaded:
            suggestions.append(
                {
                    "title": "可承接任务的成员",
                    "description": "当前负载较低：" + "、".join(item["name"] for item in underloaded[:3]) + "。",
                    "assignee_id": "",
                    "assignee_name": "",
                    "acceptance": "由负责人人工确认是否调整分配。",
                }
            )
        return Response(
            {
                "project": {"id": str(project.id), "name": project.name},
                "members": values,
                "unassigned": unassigned[:20],
                "overloaded": overloaded[:10],
                "suggestions": suggestions[:6],
                "average_active": round(average, 1),
            }
        )


class AgentKnowledgeView(LabView):
    def get(self, request, slug):
        _limit(request, "knowledge", 60)
        import html
        import re as _re
        from django.db.models import Q

        from .documents import accessible_pages

        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以查询项目知识库")
        query = str(request.query_params.get("q", "")).strip()[:100]
        if len(query) < 2:
            raise ValidationError("请输入至少 2 个字的查询")
        pages_qs = accessible_pages(request.user, self.workspace, project.id).filter(archived_at__isnull=True)
        terms = [term for term in _re.split(r"[\s,，、]+", query) if len(term) >= 1][:5]
        condition = Q()
        for term in terms or [query]:
            condition |= Q(name__icontains=term) | Q(description_html__icontains=term)
        pages = list(pages_qs.filter(condition).order_by("-updated_at")[:30])
        results = []
        for page in pages:
            text = _re.sub(r"<[^>]+>", " ", page.description_html or "")
            text = _re.sub(r"\s+", " ", html.unescape(text)).strip()
            position = -1
            haystack = text.lower()
            for term in terms or [query]:
                position = haystack.find(term.lower())
                if position >= 0:
                    break
            if position >= 0:
                snippet = text[max(0, position - 40) : position + 220]
            else:
                snippet = text[:220]
            results.append(
                {
                    "id": str(page.id),
                    "title": page.name or "未命名文档",
                    "snippet": snippet,
                    "updated_at": page.updated_at.isoformat(),
                    "url": f"/{slug}/projects/{project.id}/pages/{page.id}",
                }
            )
        return Response(
            {
                "query": query,
                "count": len(results),
                "results": results,
                "answer": (
                    f"在项目资料中找到 {len(results)} 条与「{query}」相关的内容。"
                    if results
                    else f"项目资料里没有找到与「{query}」相关的内容。"
                ),
            }
        )


class AgentFinanceView(LabView):
    def get(self, request, slug):
        _limit(request, "finance", 30)
        from decimal import Decimal, InvalidOperation

        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以查看财务概览")
        overview = finance_overview(request.user, project)
        if not overview.get("can_view_finance"):
            return Response(
                {
                    "project": {"id": str(project.id), "name": project.name},
                    "can_view_finance": False,
                    "summary": None,
                    "categories": [],
                    "anomalies": [],
                    "cashflow": None,
                }
            )
        summary = overview.get("summary") or {}

        def number(value):
            try:
                return Decimal(str(value or "0"))
            except (InvalidOperation, ValueError):
                return Decimal("0")

        categories = overview.get("categories") or []
        anomalies = []
        for category in categories:
            remaining = number(category.get("remaining"))
            if remaining < 0:
                anomalies.append(
                    {
                        "kind": "over_budget",
                        "title": f"{category.get('label') or category.get('category')} 超预算",
                        "detail": f"预算 ¥{category.get('budget')}，实际 ¥{category.get('cost')}，超出 ¥{abs(remaining)}。",
                    }
                )
        if number(summary.get("remaining")) < 0:
            anomalies.append(
                {
                    "kind": "project_over_budget",
                    "title": "项目整体超预算",
                    "detail": f"预算 ¥{summary.get('budget')}，已发生 ¥{summary.get('cost')}，剩余 ¥{summary.get('remaining')}。",
                }
            )
        costs = [
            row
            for row in overview.get("records", [])
            if row.get("kind") == "cost" and row.get("state") in ("approved", "paid")
        ]
        amounts = [number(row.get("recognized_amount") or row.get("data", {}).get("amount")) for row in costs]
        if len(amounts) >= 3:
            average = sum(amounts, Decimal("0")) / len(amounts)
            for row, amount in zip(costs, amounts):
                if average > 0 and amount > average * 2 and amount > 0:
                    anomalies.append(
                        {
                            "kind": "large_cost",
                            "title": "大额费用",
                            "detail": f"{row.get('data', {}).get('title') or row.get('data', {}).get('category') or '费用'}：¥{amount}，明显高于项目平均单笔 ¥{average.quantize(Decimal('0.01'))}。",
                        }
                    )
        cashflow = {
            "received": summary.get("received"),
            "paid": summary.get("paid"),
            "net": str(number(summary.get("received")) - number(summary.get("paid"))),
        }
        suggestions = []
        if anomalies:
            suggestions.append(
                {
                    "title": "复核预算与异常费用",
                    "description": "；".join(item["title"] for item in anomalies[:5]),
                    "acceptance": "负责人确认超支原因或调整预算/费用。",
                }
            )
        return Response(
            {
                "project": {"id": str(project.id), "name": project.name},
                "can_view_finance": True,
                "summary": summary,
                "categories": categories,
                "cashflow": cashflow,
                "anomalies": anomalies[:20],
                "suggestions": suggestions,
            }
        )


class AgentMeetingView(LabView):
    def post(self, request, slug):
        _limit(request, "meeting", 6)
        project_id = str(request.data.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以整理会议纪要")
        text = str(request.data.get("text", "")).strip()
        if not text:
            raise ValidationError("请粘贴会议纪要内容")
        if len(text) > 8000:
            raise ValidationError("会议纪要最长 8000 字")
        key, base, model = _config()
        members = list(
            ProjectMember.objects.filter(
                project=project,
                workspace_id=self.workspace.id,
                is_active=True,
                role__gte=15,
                member__is_active=True,
            ).select_related("member")[:200]
        )
        people = "、".join(f"{member.member.display_name}({member.member_id})" for member in members)
        system = (
            "你是实验室项目会议纪要整理助手。只从用户给的纪要中抽取，不编造。"
            "只输出一个 JSON 对象，字段：summary（字符串）、decisions（字符串数组）、risks（字符串数组）、"
            "tasks（数组，每项 {title, description, assignee_id, due_date, priority, acceptance}）。"
            "assignee_id 只能从项目成员 ID 中选择，不确定就留空；due_date 为 YYYY-MM-DD，不确定留空；"
            "priority 为 urgent/high/medium/low/none；最多 20 个任务。不要输出 SQL、命令或密钥。"
            f"项目：{project.name}（{project.id}）。成员：{people or '无'}。今天：{timezone.localdate().isoformat()}。"
        )
        payload = _call_deepseek(key, base, model, system, text, max_tokens=1200)
        summary = str(payload.get("summary", "")).strip()[:2000]
        decisions = [str(item).strip()[:500] for item in (payload.get("decisions") or []) if str(item).strip()][:20]
        risks = [str(item).strip()[:500] for item in (payload.get("risks") or []) if str(item).strip()][:20]
        tasks = []
        for item in (payload.get("tasks") or [])[:20]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()[:255]
            if not title:
                continue
            assignee = _plan_member(members, item.get("assignee_id"))
            due_raw = str(item.get("due_date", "")).strip()
            try:
                due_date = date.fromisoformat(due_raw).isoformat() if due_raw else ""
            except ValueError:
                due_date = ""
            priority = str(item.get("priority", "none")).strip()
            if priority not in ("urgent", "high", "medium", "low", "none"):
                priority = "none"
            tasks.append(
                {
                    "title": title,
                    "description": str(item.get("description", "")).strip()[:4000],
                    "assignee_id": str(assignee.member_id) if assignee else "",
                    "assignee_name": assignee.member.display_name if assignee else "",
                    "due_date": due_date,
                    "priority": priority,
                    "acceptance": str(item.get("acceptance", "")).strip()[:2000],
                }
            )
        return Response(
            {
                "summary": summary,
                "decisions": decisions,
                "risks": risks,
                "tasks": tasks,
            }
        )


def _proposal_data(row):
    return {
        "id": str(row.id),
        "title": row.title,
        "description": row.description,
        "category": row.category,
        "status": row.status,
        "created_by": row.user.display_name if row.user else "",
        "created_at": row.created_at.isoformat(),
        "approvals": {
            "lead": {"at": row.lead_approved_at.isoformat() if row.lead_approved_at else None, "by": row.lead_approved_by.display_name if row.lead_approved_by else ""},
            "member": {"at": row.member_approved_at.isoformat() if row.member_approved_at else None, "by": row.member_approved_by.display_name if row.member_approved_by else ""},
            "technical": {"at": row.technical_approved_at.isoformat() if row.technical_approved_at else None, "by": row.technical_approved_by.display_name if row.technical_approved_by else ""},
        },
    }


class AgentProposalView(LabView):
    def get(self, request, slug):
        _limit(request, "proposals", 40)
        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以查看提案")
        rows = AgentProposal.objects.filter(workspace=self.workspace, project=project).select_related(
            "user", "lead_approved_by", "member_approved_by", "technical_approved_by"
        )[:100]
        return Response([_proposal_data(row) for row in rows])

    def post(self, request, slug):
        _limit(request, "proposal-create", 10)
        project_id = str(request.data.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以提交提案")
        title = str(request.data.get("title", "")).strip()[:200]
        description = str(request.data.get("description", "")).strip()[:4000]
        category = str(request.data.get("category", "process")).strip()
        if not title:
            raise ValidationError("提案标题不能为空")
        if category not in AgentProposal.CATEGORIES:
            category = "process"
        proposal = AgentProposal.objects.create(
            workspace=self.workspace,
            project=project,
            user=request.user,
            title=title,
            description=description,
            category=category,
            status="review",
        )
        return Response(_proposal_data(proposal), status=201)


class AgentProposalApproveView(LabView):
    def post(self, request, slug, pk):
        _limit(request, "proposal-approve", 20)
        proposal = AgentProposal.objects.filter(id=pk, workspace=self.workspace).select_related("project").first()
        if proposal is None:
            raise ValidationError("提案不存在")
        project = proposal.project
        if not ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).exists():
            raise PermissionDenied("只有项目成员可以参与评审")
        role = str(request.data.get("role", "")).strip()
        if role not in ("lead", "member", "technical"):
            raise ValidationError("评审角色无效")
        if role == "lead":
            require_project_finance(request.user, project, "approve")
        now = timezone.now()
        if role == "lead":
            proposal.lead_approved_by = request.user
            proposal.lead_approved_at = now
        elif role == "member":
            proposal.member_approved_by = request.user
            proposal.member_approved_at = now
        else:
            proposal.technical_approved_by = request.user
            proposal.technical_approved_at = now
        if proposal.lead_approved_at and proposal.member_approved_at and proposal.technical_approved_at:
            proposal.status = "approved"
        else:
            proposal.status = "review"
        proposal.save(
            update_fields=[
                "lead_approved_by",
                "lead_approved_at",
                "member_approved_by",
                "member_approved_at",
                "technical_approved_by",
                "technical_approved_at",
                "status",
            ]
        )
        return Response(_proposal_data(proposal))


class AgentHealthView(LabView):
    def get(self, request, slug):
        llm = True
        try:
            _config()
        except Exception:
            llm = False
        cache_ok = True
        try:
            cache.set("lab-agent-health", 1, 10)
            cache.get("lab-agent-health")
        except Exception:
            cache_ok = False
        return Response(
            {
                "ok": llm and cache_ok,
                "version": "v48",
                "llm": llm,
                "cache": cache_ok,
                "threads": AgentThread.objects.filter(workspace=self.workspace, user=request.user).count(),
                "reminders": AgentReminder.objects.filter(workspace=self.workspace, user=request.user).count(),
                "proposals": AgentProposal.objects.filter(workspace=self.workspace).count(),
            }
        )


class AgentMessageAppendView(LabView):
    def post(self, request, slug):
        _limit(request, "message-append", 60)
        thread_id = str(request.data.get("thread_id", "")).strip()
        thread = AgentThread.objects.filter(id=thread_id, workspace=self.workspace, user=request.user).first()
        if thread is None:
            raise ValidationError("会话不存在")
        content = str(request.data.get("content", "")).strip()[:4000]
        draft = request.data.get("draft")
        if not isinstance(draft, dict):
            draft = {}
        if len(json.dumps(draft, ensure_ascii=False)) > 50000:
            raise ValidationError("消息内容过大")
        message = AgentMessage.objects.create(
            thread=thread,
            role="assistant",
            content=content,
            intent="special",
            draft=draft,
        )
        thread.last_message_at = timezone.now()
        thread.save(update_fields=["last_message_at"])
        return Response({"id": str(message.id)})


def _lead_request_data(row, can_review=False):
    return {
        "id": str(row.id),
        "project_id": str(row.project_id),
        "requested_by": row.requested_by.display_name if row.requested_by else "",
        "target_user_id": str(row.target_user_id),
        "target_name": row.target_user.display_name if row.target_user else "",
        "reason": row.reason,
        "status": row.status,
        "reviewed_by": row.reviewed_by.display_name if row.reviewed_by else "",
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "can_review": can_review,
    }


class AgentLeadRequestView(LabView):
    def get(self, request, slug):
        _limit(request, "lead-requests", 40)
        project_id = str(request.query_params.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        membership = ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).first()
        if membership is None:
            raise PermissionDenied("只有项目成员可以查看负责人变更")
        can_review = membership.role == 20
        rows = AgentLeadRequest.objects.filter(workspace=self.workspace, project=project).select_related(
            "requested_by", "target_user", "reviewed_by"
        )[:100]
        return Response([_lead_request_data(row, can_review) for row in rows])

    def post(self, request, slug):
        _limit(request, "lead-request-create", 10)
        project_id = str(request.data.get("project_id", "")).strip()
        project = Project.objects.filter(id=project_id, workspace=self.workspace).first()
        if project is None:
            raise ValidationError("项目不存在")
        membership = ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).first()
        if membership is None:
            raise PermissionDenied("只有项目成员可以发起负责人变更")
        target_id = str(request.data.get("target_user_id", "")).strip()
        target = ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member_id=target_id,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        ).select_related("member").first()
        if target is None:
            raise ValidationError("新负责人不是当前项目成员")
        if str(project.project_lead_id or "") == target_id:
            raise ValidationError("该成员已经是项目负责人")
        reason = str(request.data.get("reason", "")).strip()[:2000]
        row = AgentLeadRequest.objects.create(
            workspace=self.workspace,
            project=project,
            requested_by=request.user,
            target_user=target.member,
            reason=reason,
        )
        return Response(_lead_request_data(row, membership.role == 20), status=201)


class AgentLeadReviewView(LabView):
    def post(self, request, slug, pk):
        _limit(request, "lead-review", 20)
        row = AgentLeadRequest.objects.filter(id=pk, workspace=self.workspace).select_related("project", "target_user").first()
        if row is None:
            raise ValidationError("负责人变更请求不存在")
        project = row.project
        membership = ProjectMember.objects.filter(
            project=project,
            workspace_id=self.workspace.id,
            member=request.user,
            is_active=True,
            role=20,
            member__is_active=True,
        ).first()
        if membership is None:
            raise PermissionDenied("只有项目管理员可以审核负责人变更")
        if row.status != "pending":
            raise ValidationError("该请求已经处理")
        approve = request.data.get("approve") is True
        row.status = "approved" if approve else "rejected"
        row.reviewed_by = request.user
        row.reviewed_at = timezone.now()
        if approve:
            project.project_lead = row.target_user
            project.save(update_fields=["project_lead"])
        row.save(update_fields=["status", "reviewed_by", "reviewed_at"])
        return Response(_lead_request_data(row, True))
