# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Keep delayed model replies inside the project context that requested them."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from .models import AgentMessage, AgentThread


class AgentContextChanged(APIException):
    status_code = 409
    default_code = "agent_context_changed"
    default_detail = "会话项目已切换，请在当前项目重新发送。"


@transaction.atomic
def switch_thread_project(thread, workspace, user, project, message):
    """Publish the new project and its history boundary together."""
    if thread is None:
        thread = AgentThread.objects.create(
            workspace=workspace, user=user, project=project, title=message[:80],
            last_message_at=timezone.now(),
        )
    else:
        thread = AgentThread.objects.select_for_update().get(id=thread.id, workspace=workspace, user=user)
        thread.project = project
        thread.last_message_at = timezone.now()
        thread.save(update_fields=["project", "last_message_at"])
    AgentMessage.objects.create(thread=thread, role="user", content=message)
    answer = AgentMessage.objects.create(
        thread=thread, role="assistant", content=f"已切换到「{project.name}」，后续会按这个项目处理。",
        intent="project_switch", draft={},
    )
    return thread, answer


def _require_context(current, project_id, boundary_id):
    current_boundary = (
        current.messages.filter(intent="project_switch").order_by("-created_at", "-id")
        .values_list("id", flat=True).first()
    )
    if current.project_id != project_id or current_boundary != boundary_id:
        raise AgentContextChanged()


@transaction.atomic
def begin_chat_turn(thread, project_id, boundary_id, message):
    """Do not overwrite a concurrent switch with stale thread metadata."""
    current = AgentThread.objects.select_for_update().get(id=thread.id)
    _require_context(current, thread.project_id, boundary_id)
    if current.project_id is None and project_id is not None:
        current.project_id = project_id
    if current.title in ("", "新对话"):
        current.title = message[:80]
    AgentMessage.objects.create(thread=current, role="user", content=message)
    current.last_message_at = timezone.now()
    current.save(update_fields=["project", "title", "last_message_at"])
    return current


@transaction.atomic
def save_model_reply(thread, project_id, boundary_id, **values):
    """Check scope after provider latency without holding a lock during the call."""
    current = AgentThread.objects.select_for_update().get(id=thread.id)
    _require_context(current, project_id, boundary_id)
    answer = AgentMessage.objects.create(thread=current, role="assistant", **values)
    current.last_message_at = timezone.now()
    current.save(update_fields=["last_message_at"])
    return answer


def lock_thread_context(thread, project_id, boundary_id):
    """Hold the context stable during a short, transactional server action."""
    current = AgentThread.objects.select_for_update().get(id=thread.id)
    _require_context(current, project_id, boundary_id)
    return current
