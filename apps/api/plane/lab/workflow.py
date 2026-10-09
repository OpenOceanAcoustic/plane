# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db.models import Q
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from . import bounties
from .models import Audit
from .permissions import require_lead
from .planning_views import LabView
from .bounty_access import access_level, bounty_access, planning_issue_access


NODES = (
    ("publication", "发布团队任务", 0, 0),
    ("publication_review", "重大发布复核", 250, 0),
    ("claim", "成员认领与批准", 500, 0),
    ("confirm", "本人确认分工", 750, 0),
    ("active", "团队开工", 0, 130),
    ("submit", "提交成果证据", 250, 130),
    ("acceptance", "独立验收", 500, 130),
    ("major_review", "重大验收复核", 750, 130),
    ("done", "完成与 VC 记账", 0, 260),
    ("partial", "部分通过", 250, 260),
    ("rework", "返工", 500, 260),
    ("rejected", "不通过", 750, 260),
    ("cancelled", "取消并释放预算", 250, 390),
    ("reversal", "贡献更正与冲正", 500, 390),
    ("deleted", "删除悬赏", 750, 390),
)
EDGES = (
    ("publication", "publication_review"),
    ("publication", "claim"),
    ("publication_review", "claim"),
    ("claim", "confirm"),
    ("confirm", "active"),
    ("active", "submit"),
    ("submit", "acceptance"),
    ("acceptance", "major_review"),
    ("acceptance", "done"),
    ("acceptance", "partial"),
    ("acceptance", "rework"),
    ("acceptance", "rejected"),
    ("major_review", "done"),
    ("major_review", "partial"),
    ("major_review", "rework"),
    ("major_review", "rejected"),
    ("partial", "submit"),
    ("rework", "submit"),
    ("done", "reversal"),
    ("partial", "reversal"),
    ("active", "cancelled"),
    ("claim", "cancelled"),
    ("reversal", "acceptance"),
    ("publication", "deleted"),
    ("active", "deleted"),
    ("done", "deleted"),
)
AUDIT_LABELS = {
    "bounty.published": "发布团队任务",
    "bounty.publication_review": "重大发布复核通过",
    "bounty.claim": "申请认领",
    "bounty.claim_approved": "认领获批",
    "bounty.claim_confirmed": "本人确认分工",
    "bounty.started": "团队开工",
    "bounty.submitted": "提交成果",
    "bounty.accepted": "验收记账",
    "bounty.acceptance_review": "重大验收复核",
    "bounty.cancelled": "取消悬赏",
    "bounty.deleted": "删除悬赏",
    "bounty.reopened": "重新打开验收",
    "ledger.reversed": "贡献冲正",
}
AUDIT_NODES = {
    "bounty.published": "publication",
    "bounty.publication_review": "publication_review",
    "bounty.claim": "claim",
    "bounty.claim_approved": "claim",
    "bounty.claim_confirmed": "confirm",
    "bounty.started": "active",
    "bounty.submitted": "submit",
    "bounty.accepted": "acceptance",
    "bounty.acceptance_review": "major_review",
    "bounty.cancelled": "cancelled",
    "bounty.deleted": "deleted",
    "bounty.reopened": "acceptance",
    "ledger.reversed": "reversal",
}
ACCEPTANCE_RESULT_NODES = {
    "pass": "done",
    "negative": "done",
    "partial": "partial",
    "rework": "rework",
    "reject": "rejected",
}


def permitted(callback):
    try:
        callback()
        return True
    except APIException:
        return False


def actions_for(bounty, user, allocations, ledger):
    actions = []

    def add(action, label, node_id, body=None, enabled=True, reason=""):
        actions.append(
            {
                "id": f"{action}:{(body or {}).get('allocation_id', '')}",
                "action": action,
                "label": label,
                "node_id": node_id,
                "body": body or {},
                "enabled": enabled,
                "reason": reason,
            }
        )

    lead = permitted(lambda: require_lead(user, bounty.stage.project))
    editable = bool(bounty.issue_id) and permitted(
        lambda: planning_issue_access(user, bounty.stage.workspace, bounty.issue_id)
    )
    mine = next((row for row in allocations if row.user_id == user.id), None)
    reviewer = permitted(lambda: bounties.reviewer_allowed(user, bounty))
    independent = permitted(lambda: bounties.reviewer_allowed(user, bounty, independent=True))
    if bounty.status == "publication_review" and independent:
        add("publication-review", "复核发布", "publication_review")
    if bounty.status == "open":
        if (
            not mine
            and bounty.issue_id
            and not bounty.issue.archived_at
            and user.id not in (bounty.reviewer_id, bounty.independent_reviewer_id)
        ):
            add("claim", "申请认领", "claim")
        if lead:
            for row in allocations:
                if not row.approved and row.user and row.user.is_active:
                    add("approve", f"批准 {row.user_name} 的认领", "claim", {"allocation_id": str(row.id)})
            approved = [row for row in allocations if row.approved]
            ready = bool(approved) and all(row.confirmed and row.user and row.user.is_active for row in approved)
            add("start", "团队开工", "active", enabled=ready, reason="" if ready else "需要批准分工并由所有参与者确认")
        if mine and mine.approved and not mine.confirmed and editable:
            add("confirm", "确认交付约定", "confirm")
    if mine and mine.approved and not mine.closed and editable and bounty.status in ("active", "rework", "partial"):
        add("submit", "提交成果验收", "submit")
    if bounty.status == "review" and reviewer:
        add("accept", "独立验收", "acceptance")
    if bounty.status == "acceptance_review" and independent:
        pending = next((row for row in bounty.acceptances.all() if not row.approved_at), None)
        if pending:
            add("acceptance-review", "复核验收", "major_review", {"acceptance_id": str(pending.id)})
    if lead and bounty.status not in ("done", "cancelled", "rejected", "deleted"):
        add("cancel", "取消并释放未授予预算", "cancelled")
    if lead and bounty.status in ("done", "active", "partial", "rework"):
        if any(row.closed and bounties.total(row.ledger.all(), "delta") < row.planned for row in allocations):
            add("reopen", "更正后重新验收", "acceptance")
    if lead:
        reversed_ids = {row.reverses_id for row in ledger if row.reverses_id}
        for row in ledger:
            if row.delta > 0 and row.id not in reversed_ids:
                add(
                    "reverse",
                    f"冲正 {row.participant_snapshot.get('name', '')} 的 {row.delta} VC",
                    "reversal",
                    {"ledger_id": str(row.id)},
                )
    return actions


class BountyWorkflowView(LabView):
    def get(self, request, slug, pk):
        bounty = bounty_access(request.user, self.workspace, pk)
        public = access_level(request.user, bounty) == "public"
        allocations = list(bounty.allocations.all())
        if public:
            allocations = [row for row in allocations if row.user_id == request.user.id]
        ledger = [] if public else list(bounty.ledger.all())
        acceptances = [] if public else list(bounty.acceptances.all())
        current = {
            "publication_review": "publication_review",
            "active": "active",
            "review": "acceptance",
            "acceptance_review": "major_review",
            "done": "done",
            "partial": "partial",
            "rework": "rework",
            "rejected": "rejected",
            "cancelled": "cancelled",
            "deleted": "deleted",
        }.get(bounty.status, "claim")
        if bounty.status == "open" and any(row.approved for row in allocations):
            current = "confirm"
        ids = [
            bounty.id,
            *[row.id for row in allocations],
            *[row.id for row in acceptances],
            *[row.id for row in ledger],
        ]
        audits = (
            Audit.objects.filter(workspace_id_snapshot=self.workspace.id, object_id__in=ids)
            .filter(Q(action__startswith="bounty.") | Q(action="ledger.reversed"))
            .order_by("created_at", "id")
        )
        if public:
            audits = audits.filter(
                Q(action__in=("bounty.published", "bounty.publication_review"))
                | Q(object_id__in=[row.id for row in allocations])
            )
        history = [
            {
                "id": str(row.id),
                "label": AUDIT_LABELS.get(row.action, row.action),
                "node_id": AUDIT_NODES.get(row.action, "publication"),
                "actor": row.actor_name,
                "created_at": row.created_at.isoformat(),
                "reason": "" if public else str(row.details.get("reason", "")),
                "result": row.details.get("result"),
            }
            for row in audits
        ]
        for acceptance in acceptances:
            if not acceptance.approved_at:
                history.append(
                    {
                        "id": str(acceptance.id),
                        "label": "验收结果待重大复核",
                        "node_id": "acceptance",
                        "actor": acceptance.reviewer_name,
                        "created_at": acceptance.created_at.isoformat(),
                        "reason": acceptance.reason,
                        "result": acceptance.result,
                    }
                )
        history.sort(key=lambda row: (row["created_at"], row["id"]))
        completed = {row["node_id"] for row in history}
        # Results are historical only once accepted (and independently approved
        # for major work). Pending opinions must not visit outcome nodes.
        approved = {row.id: row for row in acceptances if row.approved_at}
        result_nodes = {
            ACCEPTANCE_RESULT_NODES[row.result] for row in approved.values() if row.result in ACCEPTANCE_RESULT_NODES
        }
        result_nodes.update(
            ACCEPTANCE_RESULT_NODES[row.details["result"]]
            for row in audits
            if row.action == "bounty.accepted"
            and row.object_id in approved
            and row.details.get("result") in ACCEPTANCE_RESULT_NODES
        )
        completed.update(result_nodes)
        if approved:
            completed.add("acceptance")
        nodes = [
            {
                "id": node_id,
                "label": label,
                "x": x,
                "y": y,
                "state": "current" if node_id == current else "completed" if node_id in completed else "upcoming",
            }
            for node_id, label, x, y in NODES
            if bounty.major or node_id not in ("publication_review", "major_review")
        ]
        node_ids = {row["id"] for row in nodes}
        edges = [
            {"id": f"{source}-{target}", "source": source, "target": target}
            for source, target in EDGES
            if source in node_ids
            and target in node_ids
            and not (bounty.major and (source, target) == ("publication", "claim"))
            and not (bounty.major and source == "acceptance" and target in ("done", "partial", "rework", "rejected"))
        ]
        return Response(
            {
                "bounty_id": str(bounty.id),
                "title": bounty.title,
                "status": bounty.status,
                "major": bounty.major,
                "current_node": current,
                "nodes": nodes,
                "edges": edges,
                "history": history,
                "actions": actions_for(bounty, request.user, allocations, ledger),
            }
        )
