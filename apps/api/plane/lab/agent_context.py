# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Deterministic, bounded context for the lab assistant.

Keep current state and recent turns intact before recalling older conversation.
Budgets apply to serialized JSON, never to a sliced JSON string. No model or
database is needed to prepare this context.
"""

import json
import re
from datetime import timedelta


def json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def bounded_text(value, max_chars):
    """Fit a string including JSON escaping, without slicing serialized JSON."""
    if max_chars < 2:
        raise ValueError("A JSON string needs at least two characters")
    value = str(value)
    if len(json_text(value)) <= max_chars:
        return value
    marker = "…[内容已截短]"
    if len(json_text(marker)) > max_chars:
        marker = ""
    low, high = 0, len(value)
    while low < high:
        middle = (low + high + 1) // 2
        if len(json_text(value[:middle] + marker)) <= max_chars:
            low = middle
        else:
            high = middle - 1
    return value[:low] + marker


def compact_value(value, *, text_limit=600, item_limit=12, depth=0):
    """Bound untrusted or bulky nested data and mark every omitted collection."""
    if isinstance(value, str):
        return value if len(value) <= text_limit else value[:text_limit] + "…[内容已截短]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if depth >= 6:
        return "[嵌套内容已省略]"
    if isinstance(value, dict):
        result = {
            str(key)[:100]: compact_value(item, text_limit=text_limit, item_limit=item_limit, depth=depth + 1)
            for key, item in list(value.items())[:40]
        }
        if len(value) > 40:
            result["_omitted_fields"] = len(value) - 40
        return result
    if isinstance(value, (list, tuple)):
        result = [
            compact_value(item, text_limit=text_limit, item_limit=item_limit, depth=depth + 1)
            for item in value[:item_limit]
        ]
        if len(value) > item_limit:
            result.append({"_omitted_items": len(value) - item_limit})
        return result
    return str(value)[:text_limit]


def bounded_value(value, max_chars=2400):
    """Reduce field sizes/collection counts until a complete JSON value fits."""
    if max_chars < 4:
        raise ValueError("A JSON value budget must be at least four characters")
    for text_limit, item_limit in ((800, 12), (400, 8), (200, 4), (100, 2), (40, 1)):
        candidate = compact_value(value, text_limit=text_limit, item_limit=item_limit)
        if len(json_text(candidate)) <= max_chars:
            return candidate
    fallback = {"_omitted": "内容超过上下文限额，请查询具体记录"}
    return fallback if len(json_text(fallback)) <= max_chars else None


def prepare_context(context, max_chars=14000):
    """Reserve room for server clarification and identifiers before large facts."""
    if max_chars < 64:
        raise ValueError("A context budget must be at least 64 characters")
    context = context if isinstance(context, dict) else {}
    result = {"project_facts": {}}
    for key, budget in (("pending_clarification", 3000), ("hint_record_id", 100), ("page_context", 1000)):
        if key in context:
            available = max_chars - len(json_text({**result, key: None})) + 4
            if available >= 4:
                result[key] = bounded_value(context[key], min(budget, available))
    facts = context.get("project_facts") or {}
    facts = facts if isinstance(facts, dict) else {}
    prepared = {}
    omitted = []
    # Business state and actionable records take precedence over a full roster.
    priority = (
        "project_meta",
        "project_lead",
        "permissions",
        "workflow",
        "summary",
        "available",
        "month_hours",
        "pending_payroll",
        "budget",
        "finance_records",
        "finance_record_count",
        "finance_records_truncated",
        "tasks",
        "cash_bounties",
        "bounties",
        "vc_allocations",
        "workspace_members",
    )
    for key in priority:
        if key not in facts:
            continue
        candidate = bounded_value(facts[key], 2200 if key in ("tasks", "finance_records") else 1600)
        trial = {**result, "project_facts": {**prepared, key: candidate}}
        if len(json_text(trial)) <= max_chars - min(500, max_chars // 10):
            prepared[key] = candidate
        else:
            omitted.append(key)
    result["project_facts"] = prepared
    if omitted:
        available = max_chars - len(json_text({**result, "omitted_fact_sections": None})) + 4
        if available >= 4:
            result["omitted_fact_sections"] = bounded_value(omitted, available)
    return result


def _message(row, recent=False):
    content = str(row.get("content") or "")
    limit = 2000 if recent else 700
    role = row.get("role", "user")
    result = {"role": role if role in ("user", "assistant") else "user", "content": bounded_text(content, limit)}
    if row.get("intent"):
        result["intent"] = bounded_text(row["intent"], 100)
    if row.get("draft"):
        result["draft"] = bounded_value(row["draft"], 2400 if recent else 900)
    return result


def recall_terms(query):
    """At most eight useful literal search terms, suitable for bound SQL."""
    text = str(query).lower()[:1000]
    constraints = [term for term in ("验收", "标准", "截止", "期限", "预算", "约束", "目标", "要求") if term in text]
    if re.search(r"之前|此前|早先|最早|约定|原来|前面|继续", text):
        constraints.extend(term for term in ("验收", "截止", "期限", "约束") if term not in constraints)
    ignored = {
        "项目",
        "之前",
        "此前",
        "早先",
        "最早",
        "原来",
        "前面",
        "继续",
        "一下",
        "什么",
        "我们",
        "这个",
        "那个",
        "的是",
        "是否",
        "可以",
        "请问",
        "查看",
        "查询",
        "按照",
        "告诉",
        "记得",
        "的验",
        "的截",
        "的要",
        "和截",
        "标准",
        "时间",
        "还有",
        "现在",
        "计划",
        "讨论",
    }
    words = [
        word
        for word in re.findall(r"[a-z0-9][a-z0-9_-]{2,}", text)
        if word not in {"the", "and", "what", "was", "our", "for"}
    ]
    chinese = []
    for phrase in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        chinese.extend(
            phrase[index : index + 2] for index in range(len(phrase) - 1) if phrase[index : index + 2] not in ignored
        )
    return list(dict.fromkeys([*constraints, *words, *chinese]))[:8]


def prepare_history(rows, query="", max_chars=11000, earlier=()):
    """Preserve newest turns, then recall at most three relevant earlier turns.

    `rows` must be chronological and already scoped to the current project era.
    Callers read at most 80 recent messages and 12 matching older user messages.
    Older references are never resumable drafts or instructions to execute.
    """
    if max_chars < 64:
        raise ValueError("A history budget must be at least 64 characters")
    rows = list(rows)
    recent = []
    kept_indices = set()
    # Leave a small, explicit allowance for older matching messages.
    overhead = len(json_text({"recent": [], "recalled": [], "omitted_messages": len(rows)})) - 2
    recent_budget = max_chars - overhead - min(1800, max_chars // 5)
    for index in range(len(rows) - 1, max(-1, len(rows) - 21), -1):
        candidate = _message(rows[index], recent=len(recent) < 4)
        if not recent and len(json_text([candidate])) > recent_budget:
            candidate = {"role": candidate["role"], "content": ""}
            content_budget = recent_budget - len(json_text([candidate])) + 2
            if content_budget >= 2:
                candidate["content"] = bounded_text(rows[index].get("content") or "", content_budget)
        if len(json_text([candidate, *recent])) > recent_budget:
            break
        recent.insert(0, candidate)
        kept_indices.add(index)
    query_terms = set(recall_terms(query))
    recalled = []
    candidates = []
    boundary = min(kept_indices) if kept_indices else len(rows)
    for index, row in enumerate(rows[:boundary]):
        if row.get("role") != "user":
            continue
        score = sum(term in str(row.get("content", "")).lower() for term in query_terms)
        if score:
            candidates.append((score, index, row, index))
    for index, row in enumerate(list(earlier)[:12]):
        if row.get("role") != "user":
            continue
        score = sum(term in str(row.get("content", "")).lower() for term in query_terms)
        if score:
            candidates.append((score, -1 - index, row, None))
    for _, _, row, local_index in sorted(candidates, key=lambda item: (item[0], item[1]), reverse=True)[:3]:
        candidate = {
            "role": "user",
            "content": bounded_text(row.get("content", ""), 1000),
            "historical_reference": True,
        }
        if row.get("id"):
            candidate["message_id"] = str(row["id"])
        if row.get("created_at"):
            candidate["created_at"] = str(row["created_at"])
        if (
            len(json_text({"recent": recent, "recalled": [*recalled, candidate], "omitted_messages": len(rows)}))
            <= max_chars
        ):
            recalled.append(candidate)
            if local_index is not None:
                kept_indices.add(local_index)
    return {"recent": recent, "recalled": recalled, "omitted_messages": len(rows) - len(kept_indices)}


def clarification_reply_kind(message):
    """Distinguish an explicit cancellation/new request from a short answer."""
    text = message.strip()
    if re.fullmatch(
        r"(?:取消|算了|不用了?|停止|不记了|不要了)(?:吧|这条|上一个|上一条|草稿|登记|这次工时|这条工时|工时登记)?[。.!！]?",
        text,
    ):
        return "cancel"
    if (
        len(text) > 200
        or re.search(r"[?？]", text)
        or re.search(r"改成|改为|改到|调整为|应该是|不是.*(?:今天|昨天|前天|小时|成员|日期|金额|费率)", text)
        or re.fullmatch(
            r"(?:现在|目前)?(?:余额|预算|可用资金|工资|时薪|费率|成员|负责人).{0,12}(?:多少|是谁|什么情况)(?:了|呢)?[。！!]?",
            text,
        )
        or re.match(
            r"^(?:#|请问|查看|查询|查一下|查下|列出|显示|帮我|新建|创建|生成|切换|换个|换成|改成|改为|改到|取消|批准|驳回|支付|付款|发工资|登记|记录|邀请)",
            text,
        )
    ):
        return "new_request"
    return "answer"


def pending_time_update(message, today):
    """Recognize only an entire, explicit, single-field correction.

    The caller resolves member names exactly and validates the resulting draft.
    No free text is interpreted as a financial instruction here.
    """
    text = message.strip().rstrip("。!！").strip()
    change = r"(?:改为|改成|改到|调整为|是|为|[:：])?"
    match = re.fullmatch(rf"(?:日期\s*)?{change}\s*(今天|昨天|前天|\d{{4}}-\d{{2}}-\d{{2}})", text)
    if match:
        raw = match.group(1)
        value = (
            (today - timedelta(days={"今天": 0, "昨天": 1, "前天": 2}[raw])).isoformat()
            if raw in ("今天", "昨天", "前天")
            else raw
        )
        return {"date": value}
    number = r"([+-]?[0-9]+(?:\.[0-9]+)?)"
    match = re.fullmatch(rf"(?:(?:工时|时长)\s*)?{change}\s*{number}\s*(?:小时|h)", text, re.I)
    if match:
        return {"hours": match.group(1)}
    match = re.fullmatch(rf"(?:时薪|费率)\s*{change}\s*{number}\s*(?:元(?:[/／]小时|每小时)?)?", text)
    if not match:
        match = re.fullmatch(rf"{number}\s*元\s*(?:[/／]小时|每小时)", text)
    if match:
        return {"rate": match.group(1)}
    match = re.fullmatch(
        r"(?:成员|人员|登记人|登记对象)\s*(?:改成|改为|换成|是|为|[:：])\s*([^，,。;；\n]{1,100})", text
    )
    if match:
        return {"member_selector": match.group(1).strip()}
    return None
