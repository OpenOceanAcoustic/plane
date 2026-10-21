# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Generate in-app AI reminders without changing any project or finance data.

Run from cron, e.g. every 10 minutes:
    docker compose -p ooa-plane-lab -f compose.lab.yml exec -T api python manage.py lab_ai_reminders
"""

from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from plane.db.models import Issue
from plane.lab.agent_views import AgentThread, AgentMessage, AgentReminder, finance_overview


class Command(BaseCommand):
    help = "Generate due in-app AI briefs and payroll reminders (read-only)."

    def handle(self, *args, **options):
        now = timezone.localtime()
        generated = 0
        for reminder in AgentReminder.objects.filter(enabled=True).select_related("project", "user", "workspace"):
            last_date = timezone.localtime(reminder.last_run_at).date() if reminder.last_run_at else None
            if last_date == now.date():
                continue
            if now.hour < reminder.hour:
                continue
            if reminder.kind == "weekly_brief" and now.isoweekday() != (reminder.weekday or 1):
                continue
            if reminder.kind == "payroll" and now.day != (reminder.day_of_month or 25):
                continue
            project = reminder.project
            if project is None:
                continue
            period = "weekly" if reminder.kind == "weekly_brief" else "daily"
            cutoff = now - timedelta(days=7 if period == "weekly" else 1)
            today = timezone.localdate()
            rows = list(
                Issue.objects.filter(
                    project=project,
                    deleted_at__isnull=True,
                    is_draft=False,
                    archived_at__isnull=True,
                )
                .select_related("state")
                .prefetch_related("issue_assignee__assignee")[:500]
            )
            active = completed = overdue = unassigned = 0
            for row in rows:
                group = row.state.group if row.state else ""
                open_row = group not in ("completed", "cancelled")
                if group == "completed" and row.completed_at and row.completed_at >= cutoff:
                    completed += 1
                if open_row:
                    active += 1
                    if not row.issue_assignee.all():
                        unassigned += 1
                    if row.target_date and row.target_date < today:
                        overdue += 1
            finance = {}
            try:
                overview = finance_overview(reminder.user, project)
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
                pass
            if reminder.kind == "payroll":
                content = (
                    f"今天是工资截止提醒日（每月 {reminder.day_of_month or 25} 日）。"
                    f"项目「{project.name}」当前进行中 {active} 个任务，逾期 {overdue} 个，无人负责 {unassigned} 个。"
                    "请到「资金与奖励 → 工资与报销」核对工时和工资单；本提醒不会自动发工资。"
                )
            else:
                label = "本周" if period == "weekly" else "今日"
                content = (
                    f"{label}项目简报（{project.name}）：完成 {completed} 个，进行中 {active} 个，"
                    f"逾期 {overdue} 个，无人负责 {unassigned} 个。"
                )
                if finance.get("available") is not None:
                    content += f" 当前可用资金 ¥{finance['available']}。"
                if overdue:
                    content += " 有逾期任务需要负责人处理。"
                if unassigned:
                    content += " 有任务无人负责，请尽快明确。"
            title = f"项目提醒 · {project.name}"
            thread = (
                AgentThread.objects.filter(
                    workspace=reminder.workspace,
                    project=project,
                    user=reminder.user,
                    title=title,
                )
                .order_by("-created_at")
                .first()
            )
            if thread is None:
                thread = AgentThread.objects.create(
                    workspace=reminder.workspace,
                    project=project,
                    user=reminder.user,
                    title=title,
                    last_message_at=now,
                )
            AgentMessage.objects.create(
                thread=thread,
                role="assistant",
                content=content,
                intent="reminder",
                draft={
                    "kind": "reminder",
                    "reminder": reminder.kind,
                    "period": period,
                    "completed": completed,
                    "active": active,
                    "overdue": overdue,
                    "unassigned": unassigned,
                    "finance": finance,
                },
            )
            thread.last_message_at = now
            thread.save(update_fields=["last_message_at"])
            reminder.last_run_at = now
            reminder.save(update_fields=["last_run_at"])
            generated += 1
        self.stdout.write(f"generated={generated}")
