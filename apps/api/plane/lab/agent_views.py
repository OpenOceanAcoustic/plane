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
from django.utils import timezone
from openai import OpenAI
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import Project, ProjectMember

from .finance_permissions import require_project_finance
from .labor_hours import work_hours
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


def _call_deepseek(key, base, model, system, message):
    client = OpenAI(api_key=key, base_url=base, timeout=20.0, max_retries=0)
    kwargs = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": message}],
        "temperature": 0,
        "max_tokens": 500,
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
    def post(self, request):
        try:
            return self._post(request)
        except (APIException, PermissionDenied, ValidationError):
            raise
        except Exception as exc:
            logger.exception("lab time agent unexpected failure")
            raise APIException(f"AI 服务内部错误：{type(exc).__name__}", code=500)

    def _post(self, request):
        message = str(request.data.get("message", "")).strip()
        if not message:
            raise ValidationError("请用一句话描述工时")
        if len(message) > MAX_MESSAGE:
            raise ValidationError("描述过长，请控制在 1000 字以内")
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
    def get(self, request):
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
