# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Initialize a new bounty's workflow from native states without replacing custom mappings."""

from django.db import connection, transaction
from rest_framework.exceptions import ValidationError

from plane.db.models import Project, State
from .auth import audit, lock
from .models import ProjectFlow
from .permissions import require_lead


REVIEW_NAMES = {"待验收", "review", "in review", "悬赏待验收"}


def is_review(state):
    name = state.name.strip().casefold()
    base, _, number = name.rpartition(" ")
    return name in REVIEW_NAMES or (base == "悬赏待验收" and number.isdigit())


@transaction.atomic
def ensure_bounty_flow(user, project):
    require_lead(user, project)
    lock(f"finance:{project.workspace_id}")
    with connection.cursor() as cursor:
        cursor.execute("SELECT lab_wip_lock(%s)", [project.workspace_id])
    project = (
        Project.objects.select_for_update(of=("self",), no_key=True).select_related("workspace").get(id=project.id)
    )
    require_lead(user, project)
    existing = ProjectFlow.objects.filter(project=project).first()
    if existing:
        return existing

    states = list(State.objects.filter(project=project).order_by("-default", "sequence", "id"))
    todo = next((state for state in states if state.group in ("unstarted", "backlog")), None)
    active = next(
        (state for state in states if state.group == "started" and not is_review(state)),
        None,
    )
    done = next((state for state in states if state.group == "completed"), None)
    for state, label in ((todo, "待做"), (active, "进行中"), (done, "完成")):
        if state is None:
            raise ValidationError(f"原生项目缺少{label}状态")

    review = next(
        (state for state in states if state.group == "started" and is_review(state)),
        None,
    )
    suffix = 0
    while review is None:
        name = "待验收" if suffix == 0 else "悬赏待验收" if suffix == 1 else f"悬赏待验收 {suffix}"
        candidate, _ = State.all_state_objects.get_or_create(
            project=project,
            name=name,
            deleted_at__isnull=True,
            defaults={
                "workspace": project.workspace,
                "group": "started",
                "color": active.color,
                "default": False,
                "created_by": user,
                "updated_by": user,
            },
        )
        if candidate.group == "started" and candidate.id != active.id:
            review = candidate
        suffix += 1

    # get_or_create preserves an explicit mapping that won a concurrent creation.
    # configure_flow uses update_or_create and would overwrite that mapping.
    mapping = {"todo": todo, "active": active, "review": review, "done": done}
    flow, created = ProjectFlow.objects.get_or_create(project=project, defaults=mapping)
    if created:
        details = {
            "source": "project_bounty_auto",
            "states": {key: str(state.id) for key, state in mapping.items()},
        }
        audit("planning.state_mapping", flow, actor=user, workspace=project.workspace, **details)
    return flow
