# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json

from django.core import signing
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.db.models import IssueComment, IssueSubscriber, Notification, Project
from plane.utils.html_processor import strip_tags
from .chat import (
    can_write,
    clean_content,
    identifier,
    issue_thread,
    mark_read,
    message_data,
    message_list,
    messages,
    notify_mentions,
    participants,
    resolve_thread,
    resolved_references,
    thread_access,
    thread_data,
    visible_threads,
)
from .chat_models import ChatMention, ChatMessage, ChatSubmission, ChatThread
from .chat_images import bind_images
from .permissions import collaboration_projects, readable_issues
from .planning_views import LabView


def cursor_for(row):
    return signing.dumps([row.created_at.isoformat(), str(row.id)], salt="lab-chat-page")


def cursor_filter(value, before=True, inclusive=False):
    try:
        date, key = signing.loads(value, salt="lab-chat-page")
        from django.utils.dateparse import parse_datetime

        date = parse_datetime(date)
        if date is None:
            raise ValueError()
        key = identifier(key)
    except (signing.BadSignature, ValueError, TypeError):
        raise ValidationError("分页位置无效")
    relation = "lt" if before else "gt"
    return Q(**{f"created_at__{relation}": date}) | Q(
        created_at=date, **{f"id__{relation}{'e' if inclusive else ''}": key}
    )


def activity(row, user, event, previous=None):
    """Retain legacy audit/webhook behavior, while mentions have one synchronous writer."""
    from plane.app.serializers import IssueCommentSerializer
    from plane.bgtasks.issue_activities_task import issue_activity
    from plane.bgtasks.webhook_task import model_activity

    data = IssueCommentSerializer(row).data
    transaction.on_commit(
        lambda: issue_activity.delay(
            type=f"comment.activity.{event}",
            requested_data=json.dumps(
                data if event != "deleted" else {"comment_id": str(row.id)}, cls=DjangoJSONEncoder
            ),
            actor_id=str(user.id),
            issue_id=str(row.issue_id),
            project_id=str(row.project_id),
            current_instance=json.dumps(previous, cls=DjangoJSONEncoder) if previous else None,
            epoch=int(timezone.now().timestamp()),
            notification=False,
        )
    )
    if event != "deleted":
        transaction.on_commit(
            lambda: model_activity.delay(
                model_name="issue_comment",
                model_id=str(row.id),
                requested_data=data,
                current_instance=previous,
                actor_id=str(user.id),
                slug=row.workspace.slug,
                origin=None,
            )
        )


class ChatThreadsView(LabView):
    def get(self, request, slug):
        resolve_thread(request.user, self.workspace, "workspace")
        projects = Project.objects.filter(
            id__in=collaboration_projects(request.user, self.workspace), archived_at__isnull=True
        )
        ChatThread.objects.bulk_create(
            [ChatThread(workspace=self.workspace, project=project, scope="project") for project in projects],
            ignore_conflicts=True,
        )
        # A user's assigned/created/followed work items are conversations even before their first comment.
        relevant = Q(created_by=request.user) | Q(assignees=request.user)
        relevant |= Q(id__in=IssueSubscriber.objects.filter(subscriber=request.user).values("issue_id"))
        relevant |= Q(id__in=IssueComment.objects.filter(actor=request.user).values("issue_id"))
        missing = (
            readable_issues(request.user, self.workspace)
            .filter(relevant, is_draft=False, project__archived_at__isnull=True, chat_thread__isnull=True)
            .values("id", "project_id")
            .distinct()
        )
        ChatThread.objects.bulk_create(
            [
                ChatThread(workspace=self.workspace, project_id=row["project_id"], issue_id=row["id"], scope="issue")
                for row in missing
            ],
            ignore_conflicts=True,
            batch_size=1000,
        )
        rows = visible_threads(request.user, self.workspace)
        related = Q(issue__created_by=request.user) | Q(issue__assignees=request.user)
        related |= Q(issue_id__in=IssueSubscriber.objects.filter(subscriber=request.user).values("issue_id"))
        related |= Q(issue_id__in=IssueComment.objects.filter(actor=request.user).values("issue_id"))
        related |= Q(id__in=ChatMention.objects.filter(user=request.user).values("thread_id"))
        query = str(request.query_params.get("q", "")).strip()[:100]
        if query:
            issues = readable_issues(request.user, self.workspace).filter(
                is_draft=False, project__archived_at__isnull=True
            )
            match = Q(name__icontains=query)
            if "-" in query and query.rsplit("-", 1)[1].isdigit():
                prefix, number = query.rsplit("-", 1)
                match |= Q(project__identifier__iexact=prefix, sequence_id=int(number))
            for issue in issues.filter(match).select_related("project")[:30]:
                issue_thread(issue)
            rows = rows.filter(
                Q(issue__name__icontains=query)
                | Q(project__name__icontains=query)
                | Q(scope="workspace", workspace__name__icontains=query)
                | Q(issue_id__in=issues.filter(match).values("id"))
            )
        else:
            rows = rows.filter(~Q(scope="issue") | related)
        rows = rows.select_related("workspace", "project", "issue").distinct().order_by("-activity_at", "id")
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (ValueError, TypeError):
            raise ValidationError("分页位置无效")
        page = list(rows[offset : offset + 51])
        return Response(
            {
                "results": [thread_data(row, request.user) for row in page[:50]],
                "next_offset": offset + 50 if len(page) > 50 else None,
            }
        )

    def post(self, request, slug):
        thread = resolve_thread(request.user, self.workspace, request.data.get("scope"), request.data.get("target_id"))
        return Response(thread_data(thread, request.user))


class ChatThreadView(LabView):
    def get(self, request, slug, thread_id):
        return Response(thread_data(thread_access(request.user, self.workspace, thread_id), request.user))


class ChatMessagesView(LabView):
    def get(self, request, slug, thread_id):
        thread = thread_access(request.user, self.workspace, thread_id)
        rows = messages(thread).select_related("actor")
        if thread.scope == "issue":
            rows = rows.prefetch_related("comment_reactions__actor")
        # Re-fetch the displayed window so edits/deletions are reconciled, not merely appended.
        if request.query_params.get("since"):
            rows = rows.filter(cursor_filter(request.query_params["since"], before=False, inclusive=True))
            if request.query_params.get("after"):
                rows = rows.filter(cursor_filter(request.query_params["after"], before=False))
            if request.query_params.get("until"):
                rows = rows.filter(cursor_filter(request.query_params["until"], inclusive=True))
            batch = list(rows.order_by("created_at", "id")[:201])
            selected = batch[:200]
            return Response(
                {
                    "messages": message_list(selected, thread, request.user),
                    "sync_cursor": request.query_params["since"],
                    "continue_cursor": cursor_for(selected[-1]) if len(batch) > 200 else None,
                    "can_write": can_write(request.user, thread),
                }
            )
        if request.query_params.get("around"):
            target = rows.filter(id=identifier(request.query_params["around"])).first()
            if not target:
                raise NotFound("消息已删除或不可访问")
            older = list(
                rows.filter(
                    Q(created_at__lt=target.created_at) | Q(created_at=target.created_at, id__lte=target.id)
                ).order_by("-created_at", "-id")[:26]
            )
            newer = list(
                rows.filter(
                    Q(created_at__gt=target.created_at) | Q(created_at=target.created_at, id__gt=target.id)
                ).order_by("created_at", "id")[:25]
            )
            selected = list(reversed(older)) + newer
            return Response(
                {
                    "messages": message_list(selected, thread, request.user),
                    "next_cursor": cursor_for(selected[0]) if len(older) == 26 else None,
                    "sync_cursor": cursor_for(selected[0]),
                    "end_cursor": cursor_for(selected[-1]),
                    "has_newer": rows.filter(created_at__gt=selected[-1].created_at).exists(),
                }
            )
        if request.query_params.get("before"):
            rows = rows.filter(cursor_filter(request.query_params["before"]))
        page = list(rows.order_by("-created_at", "-id")[:51])
        selected = list(reversed(page[:50]))
        return Response(
            {
                "messages": message_list(selected, thread, request.user),
                "next_cursor": cursor_for(selected[0]) if len(page) > 50 else None,
                "sync_cursor": cursor_for(selected[0]) if selected else None,
                "end_cursor": cursor_for(selected[-1]) if selected else None,
                "has_newer": False,
            }
        )

    @transaction.atomic
    def post(self, request, slug, thread_id):
        thread = thread_access(request.user, self.workspace, thread_id, write=True)
        ChatThread.objects.select_for_update().get(id=thread.id)
        key = identifier(request.data.get("client_message_id"))
        previous = ChatSubmission.objects.filter(thread=thread, user=request.user, key=key).first()
        if previous:
            row = messages(thread).filter(id=previous.message_id).first()
            if not row:
                raise ValidationError("此前发送的消息已删除")
            return Response(message_data(row, thread, request.user))
        html = clean_content(request.user, thread, request.data.get("comment_html", ""))
        parent_id = request.data.get("parent_id")
        parent = messages(thread).filter(id=identifier(parent_id)).first() if parent_id else None
        if parent_id and not parent:
            raise ValidationError("回复的消息不属于当前会话或已删除")
        if thread.scope == "issue":
            row = IssueComment.objects.create(
                workspace=self.workspace,
                project_id=thread.project_id,
                issue_id=thread.issue_id,
                actor=request.user,
                created_by=request.user,
                comment_html=html,
                parent=parent,
            )
            activity(row, request.user, "created")
        else:
            row = ChatMessage.objects.create(
                thread=thread, actor=request.user, comment_html=html, comment_stripped=strip_tags(html), parent=parent
            )
            bind_images(request.user, thread, row)
            notify_mentions(thread, row)
        ChatSubmission.objects.create(thread=thread, user=request.user, key=key, message_id=row.id)
        ChatThread.objects.filter(id=thread.id).update(activity_at=row.created_at)
        return Response(message_data(row, thread, request.user), status=201)


class ChatMessageView(LabView):
    def owned(self, request, thread_id, message_id):
        thread = thread_access(request.user, self.workspace, thread_id, write=True)
        row = messages(thread).select_for_update().filter(id=message_id).first()
        if not row:
            raise NotFound("消息不可访问")
        if not message_data(row, thread, request.user)["can_edit"]:
            raise PermissionDenied("只能修改自己的消息")
        return thread, row

    @transaction.atomic
    def patch(self, request, slug, thread_id, message_id):
        thread, row = self.owned(request, thread_id, message_id)
        previous = None
        if thread.scope == "issue":
            from plane.app.serializers import IssueCommentSerializer

            previous = IssueCommentSerializer(row).data
        row.comment_html = clean_content(request.user, thread, request.data.get("comment_html", ""), row.id)
        row.comment_stripped = strip_tags(row.comment_html)
        row.comment_json = {}
        row.edited_at = timezone.now()
        row.save()
        if thread.scope == "issue":
            activity(row, request.user, "updated", previous)
        else:
            bind_images(request.user, thread, row)
            notify_mentions(thread, row)
        return Response(message_data(row, thread, request.user))

    @transaction.atomic
    def delete(self, request, slug, thread_id, message_id):
        thread, row = self.owned(request, thread_id, message_id)
        if thread.scope == "issue":
            from plane.app.serializers import IssueCommentSerializer

            activity(row, request.user, "deleted", IssueCommentSerializer(row).data)
            # Keep reply records; existing soft deletion semantics are preserved.
            row.deleted_at = timezone.now()
            row.save(update_fields=["deleted_at"])
        else:
            row.deleted_at = timezone.now()
            row.save(update_fields=["deleted_at"])
            Notification.objects.filter(
                id__in=ChatMention.objects.filter(thread=thread, message_id=row.id).values("notification_id")
            ).update(deleted_at=timezone.now())
        return Response(status=204)


class ChatReadView(LabView):
    def post(self, request, slug, thread_id):
        thread = thread_access(request.user, self.workspace, thread_id)
        return Response(mark_read(thread, request.user, request.data.get("message_id")))


class ChatReferencesView(LabView):
    def get(self, request, slug, thread_id):
        thread = thread_access(request.user, self.workspace, thread_id)
        query = str(request.query_params.get("q", ""))[:100]
        users = participants(thread).filter(member__display_name__icontains=query).select_related("member")[:8]
        issues = readable_issues(request.user, self.workspace).filter(
            is_draft=False, archived_at__isnull=True, project__archived_at__isnull=True
        )
        match = Q(name__icontains=query)
        if "-" in query and query.rsplit("-", 1)[1].isdigit():
            prefix, number = query.rsplit("-", 1)
            match |= Q(project__identifier__iexact=prefix, sequence_id=int(number))
        issues = issues.filter(match).select_related("project").order_by("-created_at")[:8]
        return Response(
            {
                "users": [
                    {
                        "id": str(row.member_id),
                        "display_name": row.member.display_name,
                        "avatar_url": row.member.avatar_url,
                    }
                    for row in users
                ],
                "issues": [
                    {
                        "id": str(row.id),
                        "title": row.name,
                        "key": f"{row.project.identifier}-{row.sequence_id}",
                        "project_id": str(row.project_id),
                        "accessible": True,
                    }
                    for row in issues
                ],
            }
        )


class ChatResolveReferencesView(LabView):
    def get(self, request, slug):
        ids = request.query_params.getlist("id")[:100]
        html = "".join(
            f'<mention-component entity_name="issue" entity_identifier="{identifier(key)}"></mention-component>'
            for key in ids
        )
        return Response(resolved_references(request.user, self.workspace, html))
