# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only

"""Read-only role workbench: what this user can do next."""

from decimal import Decimal

from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response

from plane.db.models import ProjectMember

from .cash_bounties import row_data as cash_bounty_data, visible_cash_bounties
from .finance_permissions import project_finance_access
from .models import AgentProposal, Bounty
from .planning_views import LabView
from .project_management import latest_records, recognized_cost
from .finance_models import FinancialAccount
from .finance_services import available, finance_removal_state
from . import bounties, quotes


def _money(value):
    return str(value if isinstance(value, Decimal) else Decimal(str(value or "0")))


class MeNextActionsView(LabView):
    def get(self, request, slug):
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (TypeError, ValueError):
            raise ValidationError("待办分页参数无效")
        projects = list(
            ProjectMember.objects.filter(
                workspace=self.workspace, member=request.user, is_active=True, role__gte=15, member__is_active=True
            )
            .select_related("project")
            .order_by("project__name")
        )
        project_map = {row.project_id: row.project for row in projects}
        ids = list(project_map)
        actions = []

        for row in (
            visible_cash_bounties(request.user, self.workspace).filter(
                project_id__in=ids,
                status__in=("proposed", "open", "claimed", "submitted", "accepted"),
            )
            .select_related("project", "publisher", "reviewer", "claimed_by")
            .order_by("-created_at")
        ):
            data = cash_bounty_data(row, request.user)
            label = None
            if data.get("can_claim"):
                label = "可领取"
            elif data.get("can_submit"):
                label = "待提交"
            elif data.get("can_accept"):
                label = "待验收"
            elif data.get("can_pay"):
                label = "待付款"
            elif row.status == "proposed" and (
                row.publisher_id == request.user.id or row.project.project_lead_id == request.user.id
            ):
                label = "待审批"
            if label:
                actions.append(
                    {
                        "id": str(row.id),
                        "kind": "cash",
                        "title": row.title,
                        "amount": _money(row.amount),
                        "unit": "¥",
                        "project_id": str(row.project_id),
                        "project": row.project.name,
                        "status": row.status,
                        "action": label,
                        "url": f"/{slug}/lab/cash?bounty_id={row.id}",
                    }
                )

        for row in (
            Bounty.objects.filter(
                stage__project_id__in=ids, status__in=("open", "active", "rework", "partial", "review")
            )
            .select_related("stage__project", "stage__workspace", "issue")
            .prefetch_related("allocations__user")
            .order_by("-created_at")
        ):
            allocations = list(row.allocations.all())
            mine = next((item for item in allocations if item.user_id == request.user.id and item.approved), None)
            reviewer = False
            if row.status == "review":
                try:
                    bounties.reviewer_allowed(request.user, row)
                    reviewer = True
                except APIException:
                    pass
            label = None
            if row.status == "open" and mine and not mine.confirmed:
                label = "确认分工"
            elif mine and mine.confirmed and not mine.closed and row.status in ("active", "rework", "partial"):
                label = "待提交"
            elif reviewer:
                label = "待验收"
            elif row.status == "open" and not mine:
                if quotes.can_apply(request.user, row):
                    label = "可报价"
            if label:
                actions.append(
                    {
                        "id": str(row.id),
                        "kind": "team",
                        "title": row.title,
                        "amount": _money(row.budget),
                        "unit": "VC",
                        "project_id": str(row.stage.project_id),
                        "project": row.stage.project.name,
                        "status": row.status,
                        "action": label,
                        "url": f"/{slug}/lab/bounties?bounty_id={row.id}",
                    }
                )

        for row in AgentProposal.objects.filter(
            workspace=self.workspace, project_id__in=ids, status="review"
        ).select_related("project", "user"):
            if request.user.id in {row.lead_approved_by_id, row.member_approved_by_id, row.technical_approved_by_id}:
                continue
            if row.member_approved_at and row.technical_approved_at:
                permissions, _ = project_finance_access(request.user, row.project)
                if row.lead_approved_at or "approve" not in permissions:
                    continue
            actions.append(
                {
                    "id": str(row.id),
                    "kind": "proposal",
                    "title": row.title,
                    "amount": "",
                    "unit": "",
                    "project_id": str(row.project_id),
                    "project": row.project.name,
                    "status": row.status,
                    "action": "待三方评审",
                    "url": f"/{slug}/lab/ai",
                }
            )

        closed_projects = finance_removal_state(self.workspace)["projects"]
        for project_id, project in project_map.items():
            if project.archived_at or project_id in closed_projects:
                continue
            permissions, _ = project_finance_access(request.user, project)
            if not {"approve", "pay"}.intersection(permissions):
                continue
            rows = list(latest_records(project_id))
            for row in rows:
                if row.kind == "cost" and row.state == "submitted" and "approve" in permissions:
                    actions.append(
                        {
                            "id": str(row.object_key),
                            "kind": "cost",
                            "title": row.data.get("work", "待核准工时"),
                            "amount": _money(row.data.get("amount", "0")),
                            "unit": "¥",
                            "project_id": str(project_id),
                            "project": project.name,
                            "status": row.state,
                            "action": "待核准",
                            "url": f"/{slug}/lab/finance?project_id={project_id}",
                        }
                    )
                elif "pay" in permissions and (
                    row.kind == "payroll"
                    and row.state == "ready"
                    or row.kind == "cost"
                    and row.state == "approved"
                    and row.data.get("category") != "labor"
                ):
                    amount = Decimal(row.data["amount"]) if row.kind == "payroll" else recognized_cost(row, rows)
                    if amount <= 0:
                        continue
                    actions.append(
                        {
                            "id": str(row.object_key),
                            "kind": row.kind,
                            "title": f"工资单：{row.data.get('user_name', '')}"
                            if row.kind == "payroll"
                            else row.data.get("work", "待报销费用"),
                            "amount": _money(amount),
                            "unit": "¥",
                            "project_id": str(project_id),
                            "project": project.name,
                            "status": row.state,
                            "action": "待付款",
                            "url": f"/{slug}/lab/finance?project_id={project_id}",
                        }
                    )

        for project_id, project in project_map.items():
            permissions, _ = project_finance_access(request.user, project)
            if "view" not in permissions:
                continue
            cash = FinancialAccount.objects.filter(project_id=project_id, kind="project").first()
            if cash is not None and available(cash) < 0:
                actions.append(
                    {
                        "id": f"cash-{project_id}",
                        "kind": "finance",
                        "title": "项目现金余额为负",
                        "amount": _money(available(cash)),
                        "unit": "¥",
                        "project_id": str(project_id),
                        "project": project.name,
                        "status": "negative",
                        "action": "需要处理",
                        "url": f"/{slug}/lab/finance?project_id={project_id}",
                    }
                )
        actions.sort(key=lambda item: (item["kind"], item["project"], item["title"], item["id"]))
        return Response(
            {
                "items": actions[offset : offset + 100],
                "count": len(actions),
                "next_offset": offset + 100 if offset + 100 < len(actions) else None,
            }
        )
