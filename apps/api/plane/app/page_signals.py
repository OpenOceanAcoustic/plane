"""Invalidate live authorization only after persisted permission changes commit."""

import json
import logging
from django.db import transaction
from django.db.models.signals import pre_save, post_save, post_delete
from django.utils import timezone
from redis.exceptions import RedisError
from plane.settings.redis import redis_instance

logger = logging.getLogger("plane.api")
PERMISSION_FIELDS = {
    "Page": ("access", "owned_by_id", "is_locked", "archived_at", "deleted_at"),
    "ProjectPage": ("project_id", "page_id", "deleted_at"),
    "ProjectMember": ("member_id", "project_id", "is_active", "role", "deleted_at"),
    "WorkspaceMember": ("member_id", "is_active", "role", "deleted_at"),
    "Workspace": ("slug", "deleted_at"),
    "Project": ("archived_at", "deleted_at", "guest_view_all_features"),
    "User": ("is_active",),
}


def invalidate_access(*, user_id=None, page_id=None, project_id=None, workspace_id=None, using=None):
    fields = {"userId": user_id, "pageId": page_id, "projectId": project_id, "workspaceId": workspace_id}
    scope = {key: str(value) for key, value in fields.items() if value is not None}
    if not scope:
        return
    message = json.dumps({"command": "invalidate_access", **scope, "timestamp": timezone.now().isoformat()})

    def publish():
        try:
            redis_instance().publish("hocuspocus:admin", message)
        except RedisError:
            # Live's bounded periodic recheck also covers missed invalidations.
            logger.error("Live permission invalidation unavailable")

    transaction.on_commit(publish, using=using)


def before_save(sender, instance, raw=False, using=None, **kwargs):
    if raw:
        return
    fields = PERMISSION_FIELDS[sender.__name__]
    previous = sender._base_manager.using(using).filter(pk=instance.pk).values(*fields).first()
    instance._live_access_changed = previous is not None and any(
        previous[field] != getattr(instance, field) for field in fields
    )


def after_change(sender, instance, created=False, raw=False, using=None, **kwargs):
    if raw or created or (kwargs.get("signal") is post_save and not getattr(instance, "_live_access_changed", False)):
        return
    name = sender.__name__
    scope = {}
    if name == "User":
        scope["user_id"] = instance.id
    else:
        scope["workspace_id"] = instance.id if name == "Workspace" else instance.workspace_id
        if name in ("ProjectMember", "WorkspaceMember"):
            scope["user_id"] = instance.member_id
        if name in ("ProjectMember", "ProjectPage"):
            scope["project_id"] = instance.project_id
        if name == "Project":
            scope["project_id"] = instance.id
        if name == "Page":
            scope["page_id"] = instance.id
        if name == "ProjectPage":
            scope["page_id"] = instance.page_id
    invalidate_access(**scope, using=using)


def register_page_signals():
    for name in PERMISSION_FIELDS:
        sender = f"db.{name}"
        pre_save.connect(before_save, sender=sender, dispatch_uid=f"live.access.before.{name}")
        post_save.connect(after_change, sender=sender, dispatch_uid=f"live.access.after.{name}")
        post_delete.connect(after_change, sender=sender, dispatch_uid=f"live.access.delete.{name}")
