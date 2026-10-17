# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Conversation access and presentation. IssueComment remains the work-item source of truth."""

import uuid

from bs4 import BeautifulSoup
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from plane.db.models import IssueComment, Notification, Project, ProjectMember, WorkspaceMember
from plane.utils.content_validator import validate_html_content
from plane.utils.html_processor import strip_tags
from .chat_models import ChatMention, ChatMessage, ChatReadState, ChatThread
from .permissions import collaboration_projects, issue_access, readable_issues


def identifier(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("记录 ID 格式无效")


def visible_threads(user, workspace):
    if not WorkspaceMember.objects.filter(
        workspace=workspace, member=user, is_active=True, member__is_active=True
    ).exists():
        return ChatThread.objects.none()
    projects = collaboration_projects(user, workspace).filter(archived_at__isnull=True)
    issues = readable_issues(user, workspace).filter(is_draft=False, project__archived_at__isnull=True)
    return ChatThread.objects.filter(workspace=workspace).filter(
        Q(scope="workspace") | Q(scope="project", project_id__in=projects) | Q(scope="issue", issue_id__in=issues)
    )


def thread_access(user, workspace, thread_id, write=False):
    thread = (
        visible_threads(user, workspace)
        .select_related("workspace", "project", "issue")
        .filter(id=identifier(thread_id))
        .first()
    )
    if not thread:
        raise NotFound("会话不可访问")
    if write and not can_write(user, thread):
        raise PermissionDenied("此会话只读")
    return thread


def can_write(user, thread):
    if hasattr(thread, "_chat_can_write"):
        return thread._chat_can_write
    if thread.scope == "workspace":
        return True
    if thread.project.archived_at or (thread.issue_id and thread.issue.archived_at):
        return False
    return ProjectMember.objects.filter(
        project_id=thread.project_id, member=user, is_active=True, role__in=[5, 15, 20]
    ).exists()


def resolve_thread(user, workspace, scope, target=None):
    if scope == "workspace":
        return ChatThread.objects.get_or_create(workspace=workspace, scope="workspace")[0]
    if scope == "project":
        project = Project.objects.filter(
            workspace=workspace,
            id=identifier(target),
            id__in=collaboration_projects(user, workspace),
            archived_at__isnull=True,
        ).first()
        if not project:
            raise NotFound("项目不可访问")
        return ChatThread.objects.get_or_create(workspace=workspace, scope=scope, project=project)[0]
    if scope == "issue":
        issue = issue_access(user, workspace, identifier(target))
        if issue.project.archived_at:
            raise NotFound("工作项不可访问")
        return issue_thread(issue)
    raise ValidationError("会话类型无效")


def issue_thread(issue):
    return ChatThread.objects.get_or_create(
        issue=issue, defaults={"workspace_id": issue.workspace_id, "project_id": issue.project_id, "scope": "issue"}
    )[0]


def messages(thread):
    if thread.scope == "issue":
        return IssueComment.objects.filter(
            workspace_id=thread.workspace_id, project_id=thread.project_id, issue_id=thread.issue_id
        )
    return ChatMessage.objects.filter(thread=thread, deleted_at__isnull=True)


def mention_ids(html, kind):
    result = set()
    for node in BeautifulSoup(html or "", "html.parser").find_all("mention-component", attrs={"entity_name": kind}):
        try:
            result.add(uuid.UUID(node.get("entity_identifier", "")))
        except (ValueError, TypeError, AttributeError):
            continue
    return result


def participants(thread):
    members = WorkspaceMember.objects.filter(workspace_id=thread.workspace_id, is_active=True, member__is_active=True)
    if thread.project_id:
        project_members = ProjectMember.objects.filter(project_id=thread.project_id, is_active=True)
        if thread.scope == "project":
            project_members = project_members.exclude(role=5, project__guest_view_all_features=False)
        elif thread.issue_id:
            project_members = project_members.filter(
                ~Q(role=5, project__guest_view_all_features=False) | Q(member_id=thread.issue.created_by_id)
            )
        members = members.filter(member_id__in=project_members.values("member_id"))
    return members


def clean_content(user, thread, html):
    if not isinstance(html, str) or len(html) > 100000:
        raise ValidationError("消息内容过长或格式无效")
    valid, _, clean = validate_html_content(html)
    if not valid:
        raise ValidationError("消息内容格式无效")
    soup = BeautifulSoup(clean if clean is not None else html, "html.parser")
    for node in soup.find_all("mention-component"):
        kind = node.get("entity_name")
        target = identifier(node.get("entity_identifier"))
        if kind == "issue":
            issue_access(user, thread.workspace, target)
        elif kind == "user_mention":
            if not participants(thread).filter(member_id=target).exists():
                raise ValidationError("被提及的成员无法访问此会话")
        else:
            raise ValidationError("不支持的引用类型")
        # Labels are resolved for each reader, never copied from the sender's editor.
        node.clear()
        node.attrs = {"id": str(target), "entity_identifier": str(target), "entity_name": kind}
    if not soup.get_text().strip() and not soup.find(["mention-component", "img"]):
        raise ValidationError("消息不能为空")
    if thread.scope != "issue" and soup.find(["img", "video", "audio", "iframe", "image-component", "file-component"]):
        raise ValidationError("此会话暂不支持图片或附件")
    return str(soup)


def resolved_references(user, workspace, html):
    ids = mention_ids(html, "issue")
    rows = (
        readable_issues(user, workspace)
        .filter(id__in=ids, is_draft=False, project__archived_at__isnull=True)
        .select_related("project")
    )
    found = {row.id: row for row in rows}
    return {
        str(key): {
            "id": str(key),
            "accessible": key in found,
            **(
                {
                    "title": found[key].name,
                    "key": f"{found[key].project.identifier}-{found[key].sequence_id}",
                    "project_id": str(found[key].project_id),
                }
                if key in found
                else {}
            ),
        }
        for key in ids
    }


def safe_html(html):
    soup = BeautifulSoup(html or "", "html.parser")
    for node in soup.find_all("mention-component", attrs={"entity_name": "issue"}):
        target = node.get("entity_identifier", "")
        node.clear()
        node.attrs = {"id": target, "entity_identifier": target, "entity_name": "issue"}
    return str(soup)


def message_data(row, thread, user):
    html = safe_html(row.comment_html)
    author = row.actor
    admin = getattr(thread, "_chat_admin", None)
    if admin is None:
        admin = (
            WorkspaceMember.objects.filter(
                workspace_id=thread.workspace_id, member=user, is_active=True, role=20
            ).exists()
            if thread.scope == "workspace"
            else ProjectMember.objects.filter(
                project_id=thread.project_id, member=user, is_active=True, role=20
            ).exists()
        )
        thread._chat_admin = admin
        thread._chat_can_write = can_write(user, thread)
    editable = can_write(user, thread) and (row.actor_id == user.id or admin)
    reactions = []
    if thread.scope == "issue":
        from plane.app.serializers import CommentReactionSerializer

        reactions = CommentReactionSerializer(row.comment_reactions.all(), many=True).data
    return {
        "id": str(row.id),
        "workspace": str(thread.workspace_id),
        "thread_id": str(thread.id),
        "actor": str(row.actor_id) if row.actor_id else "",
        "actor_detail": {
            "id": str(author.id),
            "display_name": author.display_name,
            "avatar_url": author.avatar_url,
            "is_bot": author.is_bot,
            "first_name": author.first_name,
            "last_name": author.last_name,
        }
        if author
        else {
            "id": "",
            "display_name": "已停用成员",
            "avatar_url": "",
            "is_bot": False,
            "first_name": "",
            "last_name": "",
        },
        "comment_html": html,
        "comment_json": {},
        "comment_stripped": strip_tags(html),
        "created_at": row.created_at.isoformat(),
        "edited_at": row.edited_at.isoformat() if row.edited_at else None,
        "updated_at": (row.edited_at or row.created_at).isoformat(),
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "access": getattr(row, "access", "INTERNAL"),
        "attachments": getattr(row, "attachments", []),
        "comment_reactions": reactions,
        "references": {
            str(key): value
            for key in mention_ids(html, "issue")
            if (value := getattr(thread, "_chat_references", {}).get(str(key))) is not None
        }
        if hasattr(thread, "_chat_references")
        else resolved_references(user, thread.workspace, html),
        "can_edit": editable,
        "can_delete": editable,
    }


def message_list(rows, thread, user):
    thread._chat_references = resolved_references(user, thread.workspace, "".join(row.comment_html for row in rows))
    return [message_data(row, thread, user) for row in rows]


def unread_messages(thread, user):
    state = ChatReadState.objects.filter(thread=thread, user=user).first()
    baseline = max(thread.baseline_at, state.read_at) if state else thread.baseline_at
    newer = Q(created_at__gt=baseline)
    if state and state.message_id and state.read_at >= thread.baseline_at:
        newer |= Q(created_at=baseline, id__gt=state.message_id)
    return messages(thread).filter(newer).exclude(actor=user)


def thread_data(thread, user):
    latest = messages(thread).order_by("-created_at", "-id").first()
    title = (
        thread.workspace.name
        if thread.scope == "workspace"
        else thread.issue.name
        if thread.issue_id
        else thread.project.name
    )
    return {
        "id": str(thread.id),
        "workspace": str(thread.workspace_id),
        "scope": thread.scope,
        "title": title,
        "project_id": str(thread.project_id) if thread.project_id else None,
        "issue_id": str(thread.issue_id) if thread.issue_id else None,
        "can_write": can_write(user, thread),
        "unread_count": unread_messages(thread, user).count(),
        "activity_at": (latest.created_at if latest else thread.created_at).isoformat(),
        "preview": strip_tags(safe_html(latest.comment_html))[:120] if latest else "",
    }


def notify_mentions(thread, row):
    if not row.actor_id:
        return
    eligible = (
        participants(thread)
        .filter(member_id__in=mention_ids(row.comment_html, "user_mention"))
        .exclude(member_id=row.actor_id)
    )
    for member in eligible:
        mention, created = ChatMention.objects.get_or_create(thread=thread, message_id=row.id, user_id=member.member_id)
        if not created:
            continue
        notification = Notification.objects.create(
            workspace_id=thread.workspace_id,
            project_id=thread.project_id,
            entity_name="chat",
            entity_identifier=thread.id,
            receiver_id=member.member_id,
            triggered_by_id=row.actor_id,
            sender="chat.mentioned",
            title="在聊天中提及了你",
            data={"chat": {"thread_id": str(thread.id), "message_id": str(row.id)}},
            message_html="<p>在聊天中提及了你</p>",
            message_stripped="在聊天中提及了你",
        )
        mention.notification = notification
        mention.save(update_fields=["notification"])


def visible_chat_notifications(queryset, user, workspace):
    allowed = visible_threads(user, workspace).values("id")
    return queryset.filter(~Q(entity_name="chat") | Q(entity_name="chat", entity_identifier__in=allowed))


def before_issue_comment_save(sender, instance, raw=False, **kwargs):
    if raw or not instance.issue_id or instance.deleted_at:
        return
    thread = issue_thread(instance.issue)
    if instance.parent_id:
        parent = IssueComment.all_objects.filter(
            id=instance.parent_id,
            issue_id=instance.issue_id,
            project_id=instance.project_id,
            workspace_id=instance.workspace_id,
        ).first()
        if not parent or (instance._state.adding and parent.deleted_at):
            raise ValidationError("回复的消息不属于当前会话或已删除")
    if (
        not instance._state.adding
        and IssueComment.objects.filter(id=instance.id, comment_html=instance.comment_html).exists()
    ):
        return
    # All legacy writers get the same canonical reference format and access checks.
    if instance.actor_id and (
        mention_ids(instance.comment_html, "issue") or mention_ids(instance.comment_html, "user_mention")
    ):
        from crum import get_current_user

        current_user = get_current_user()
        editor = current_user if current_user and current_user.is_authenticated else instance.actor
        instance.comment_html = clean_content(editor, thread, instance.comment_html)
        instance.comment_json = {}  # Do not retain untrusted duplicate labels in an alternate representation.
        instance.comment_stripped = strip_tags(instance.comment_html)


def after_issue_comment_save(sender, instance, raw=False, **kwargs):
    if raw or not instance.issue_id:
        return
    thread = issue_thread(instance.issue)
    ChatThread.objects.filter(id=thread.id).update(activity_at=timezone.now())
    if not instance.deleted_at:
        notify_mentions(thread, instance)
    else:
        Notification.objects.filter(
            id__in=ChatMention.objects.filter(thread=thread, message_id=instance.id).values("notification_id")
        ).update(deleted_at=timezone.now())


@transaction.atomic
def mark_read(thread, user, message_id):
    row = messages(thread).filter(id=identifier(message_id)).first()
    if not row:
        raise NotFound("消息不可访问")
    # Lock the thread to make the first read and concurrent tabs monotonic too.
    ChatThread.objects.select_for_update().get(id=thread.id)
    state, _ = ChatReadState.objects.get_or_create(thread=thread, user=user, defaults={"read_at": thread.baseline_at})
    if (row.created_at, row.id.int) > (state.read_at, state.message_id.int if state.message_id else 0):
        state.read_at, state.message_id = row.created_at, row.id
        state.save(update_fields=["read_at", "message_id"])
    return {"unread_count": unread_messages(thread, user).count()}
