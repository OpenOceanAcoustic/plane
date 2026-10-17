# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from unittest.mock import patch

import pytest
from django.utils import timezone

from plane.db.models import Issue, IssueComment, Notification, ProjectMember, Workspace, WorkspaceMember
from plane.lab.chat_models import ChatMention, ChatReadState, ChatThread

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture(autouse=True)
def isolated_services(settings):
    settings.APP_BASE_URL = "http://testserver"
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    with (
        patch("plane.bgtasks.issue_activities_task.issue_activity.delay"),
        patch("plane.bgtasks.webhook_task.model_activity.delay"),
        patch("plane.bgtasks.deletion_task.soft_delete_related_objects.delay"),
    ):
        yield


def resolve(lab, scope="workspace", target=None, user=None):
    response = lab["client"](user or lab["member"]).post(
        lab["base"] + "chat/threads/", {"scope": scope, "target_id": str(target) if target else None}, format="json"
    )
    assert response.status_code == 200, response.content
    return response.json()


def send(lab, thread, html="<p>消息</p>", user=None, **extra):
    return lab["client"](user or lab["member"]).post(
        lab["base"] + f"chat/threads/{thread['id']}/messages/",
        {"comment_html": html, "client_message_id": str(uuid.uuid4()), **extra},
        format="json",
    )


def page(lab, thread, user=None, query=""):
    response = lab["client"](user or lab["member"]).get(lab["base"] + f"chat/threads/{thread['id']}/messages/" + query)
    assert response.status_code == 200, response.content
    return response.json()


def issue(lab, **extra):
    row = Issue(
        workspace=lab["workspace"],
        project=lab["project"],
        name="实验工作项",
        state=lab["states"]["todo"],
        created_by=lab["member"],
        **extra,
    )
    row.save(created_by_id=lab["member"].id)
    return row


@pytest.mark.parametrize("scope", ["workspace", "project", "issue"])
def test_scope_crud_replies_and_idempotent_retries(laboratory, scope):
    lab = laboratory
    target = issue(lab).id if scope == "issue" else lab["project"].id if scope == "project" else None
    thread = resolve(lab, scope, target)
    assert resolve(lab, scope, target)["id"] == thread["id"]
    key = str(uuid.uuid4())
    first = send(lab, thread, client_message_id=key)
    assert first.status_code == 201, first.content
    again = send(lab, thread, client_message_id=key)
    assert again.status_code == 200 and first.json()["id"] == again.json()["id"]
    reply = send(lab, thread, parent_id=first.json()["id"])
    assert reply.status_code == 201 and reply.json()["parent_id"] == first.json()["id"]
    url = lab["base"] + f"chat/threads/{thread['id']}/messages/{first.json()['id']}/"
    assert lab["client"](lab["reviewer"]).patch(url, {"comment_html": "<p>越权</p>"}, format="json").status_code == 403
    updated = lab["client"](lab["member"]).patch(url, {"comment_html": "<p>修改</p>"}, format="json")
    assert updated.status_code == 200 and updated.json()["edited_at"]
    assert lab["client"](lab["member"]).delete(url).status_code == 204
    rows = page(lab, thread)["messages"]
    assert len(rows) == 1 and rows[0]["id"] == reply.json()["id"]
    if scope == "issue":
        assert IssueComment.objects.filter(issue_id=target).count() == 1


def test_unread_is_monotonic_and_excludes_own_messages(laboratory):
    lab = laboratory
    thread = resolve(lab)
    one = send(lab, thread).json()
    two = send(lab, thread).json()
    reader = lab["client"](lab["reviewer"])
    base = lab["base"] + f"chat/threads/{thread['id']}/"
    assert reader.get(base).json()["unread_count"] == 2
    assert lab["client"](lab["member"]).get(base).json()["unread_count"] == 0
    assert reader.post(base + "read/", {"message_id": two["id"]}, format="json").json()["unread_count"] == 0
    reader.post(base + "read/", {"message_id": one["id"]}, format="json")
    assert str(ChatReadState.objects.get(thread_id=thread["id"], user=lab["reviewer"]).message_id) == two["id"]
    assert reader.post(base + "read/", {"message_id": str(uuid.uuid4())}, format="json").status_code == 404


def test_cross_project_reference_redaction_and_mentions_once(laboratory):
    lab = laboratory
    target = issue(lab)
    thread = resolve(lab)
    html = (
        f'<p><mention-component entity_name="issue" entity_identifier="{target.id}" '
        'title="秘密">秘密标题</mention-component>'
        '<mention-component entity_name="user_mention" '
        f'entity_identifier="{lab["reviewer"].id}"></mention-component></p>'
    )
    row = send(lab, thread, html).json()
    assert row["references"][str(target.id)]["title"] == target.name
    assert "秘密" not in row["comment_html"]
    assert Notification.objects.filter(receiver=lab["reviewer"], entity_name="chat").count() == 1
    edit = lab["base"] + f"chat/threads/{thread['id']}/messages/{row['id']}/"
    assert (
        lab["client"](lab["member"]).patch(edit, {"comment_html": html + "<p>更新</p>"}, format="json").status_code
        == 200
    )
    assert ChatMention.objects.count() == 1
    ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(is_active=False)
    restricted = page(lab, thread, user=lab["reviewer"])["messages"][0]
    assert restricted["references"][str(target.id)] == {"id": str(target.id), "accessible": False}
    assert target.name not in str(Notification.objects.get(receiver=lab["reviewer"]).data)
    assert send(lab, thread, html, user=lab["reviewer"]).status_code == 404


def test_permissions_revocation_foreign_workspace_and_reply_validation(laboratory):
    lab = laboratory
    thread = resolve(lab, "project", lab["project"].id)
    foreign = Workspace.objects.create(name="Other", slug="other", owner=lab["lead"])
    WorkspaceMember.objects.create(workspace=foreign, member=lab["member"], role=15)
    assert (
        lab["client"](lab["member"]).get(f"/api/workspaces/other/lab/chat/threads/{thread['id']}/").status_code == 404
    )
    other = resolve(lab)
    row = send(lab, other).json()
    assert send(lab, thread, parent_id=row["id"]).status_code == 400
    ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(role=5)
    lab["project"].guest_view_all_features = False
    lab["project"].save()
    assert send(lab, thread).status_code == 404
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["reviewer"]).update(is_active=False)
    assert send(lab, other, user=lab["reviewer"]).status_code == 403


def test_legacy_comments_share_data_mentions_and_read_only_archive(laboratory):
    lab = laboratory
    target = issue(lab)
    thread = resolve(lab, "issue", target.id)
    legacy = f"/api/workspaces/{lab['workspace'].slug}/projects/{lab['project'].id}/issues/{target.id}/comments/"
    response = lab["client"](lab["member"]).post(
        legacy,
        {
            "comment_html": (
                '<p>旧入口 <mention-component entity_name="user_mention" '
                f'entity_identifier="{lab["reviewer"].id}"></mention-component></p>'
            )
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    assert page(lab, thread)["messages"][0]["id"] == response.json()["id"]
    assert Notification.objects.filter(receiver=lab["reviewer"], entity_name="chat").count() == 1
    target.archived_at = timezone.now()
    target.save()
    assert not resolve(lab, "issue", target.id)["can_write"]
    assert send(lab, thread).status_code == 403
    assert len(page(lab, thread)["messages"]) == 1


def test_pagination_sync_reconciles_edit_and_delete(laboratory):
    lab = laboratory
    thread = resolve(lab)
    from plane.lab.chat_models import ChatMessage

    model = ChatThread.objects.get(id=thread["id"])
    ChatMessage.objects.bulk_create(
        [ChatMessage(thread=model, actor=lab["member"], comment_html=f"<p>{index}</p>") for index in range(55)]
    )
    latest = page(lab, thread)
    assert len(latest["messages"]) == 50 and latest["next_cursor"]
    older = page(lab, thread, query="?before=" + latest["next_cursor"])
    assert len(older["messages"]) == 5
    target = latest["messages"][4]
    url = lab["base"] + f"chat/threads/{thread['id']}/messages/{target['id']}/"
    lab["client"](lab["member"]).delete(url)
    synced = page(lab, thread, query="?since=" + latest["sync_cursor"])
    assert len(synced["messages"]) == 49 and target["id"] not in [row["id"] for row in synced["messages"]]


def test_rejected_payloads_and_notification_access(laboratory):
    lab = laboratory
    thread = resolve(lab, "project", lab["project"].id)
    assert send(lab, thread, "<p> </p>").status_code == 400
    assert send(lab, thread, '<p><img src="https://example.test/image.png"></p>').status_code == 400
    row = send(
        lab,
        thread,
        (
            '<p><mention-component entity_name="user_mention" '
            f'entity_identifier="{lab["reviewer"].id}"></mention-component></p>'
        ),
    )
    assert row.status_code == 201, row.content
    client = lab["client"](lab["reviewer"])
    url = f"/api/workspaces/{lab['workspace'].slug}/users/notifications/?mentioned=true&per_page=50&cursor=50:0:0"
    response = client.get(url)
    assert response.status_code == 200, response.content
    assert any(value["entity_name"] == "chat" for value in response.json()["results"])
    count_url = f"/api/workspaces/{lab['workspace'].slug}/users/notifications/unread/"
    assert client.get(count_url).json()["mention_unread_notifications_count"] == 1
    ProjectMember.objects.filter(project=lab["project"], member=lab["reviewer"]).update(is_active=False)
    assert not any(value["entity_name"] == "chat" for value in client.get(url).json()["results"])
    assert client.get(count_url).json()["mention_unread_notifications_count"] == 0


def test_default_list_contains_related_items_before_first_comment_and_search_finds_others(laboratory):
    from plane.db.models import IssueSubscriber

    lab = laboratory
    own = issue(lab)
    other = Issue.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        name="别人的搜索目标",
        state=lab["states"]["todo"],
        created_by=lab["reviewer"],
    )
    client = lab["client"](lab["member"])
    url = lab["base"] + "chat/threads/"
    initial = client.get(url)
    assert initial.status_code == 200, initial.content
    assert {row["scope"] for row in initial.json()["results"]} == {"workspace", "project", "issue"}
    assert {row["issue_id"] for row in initial.json()["results"] if row["scope"] == "issue"} == {str(own.id)}
    found = client.get(url, {"q": "别人的搜索目标"}).json()["results"]
    assert [row["issue_id"] for row in found] == [str(other.id)]
    IssueSubscriber.objects.create(
        workspace=lab["workspace"], project=lab["project"], issue=other, subscriber=lab["member"]
    )
    assert {row["issue_id"] for row in client.get(url).json()["results"] if row["scope"] == "issue"} == {
        str(own.id),
        str(other.id),
    }


def test_backfill_preserves_old_comments_and_starts_them_read(laboratory):
    from importlib import import_module
    from django.apps import apps
    from django.db import connection
    from datetime import timedelta

    lab = laboratory
    target = issue(lab)
    comment = IssueComment.objects.create(
        workspace=lab["workspace"],
        project=lab["project"],
        issue=target,
        actor=lab["member"],
        comment_html="<p>旧评论</p>",
    )
    IssueComment.objects.filter(id=comment.id).update(created_at=timezone.now() - timedelta(days=2))
    ChatThread.objects.filter(issue=target).delete()
    migrate = import_module("plane.lab.migrations.0018_chat_conversations").backfill_comment_threads
    with connection.schema_editor() as editor:
        migrate(apps, editor)
        migrate(apps, editor)
    thread = resolve(lab, "issue", target.id, user=lab["reviewer"])
    assert thread["unread_count"] == 0
    assert ChatThread.objects.filter(issue=target).count() == 1
    assert page(lab, thread)["messages"][0]["id"] == str(comment.id)
    assert IssueComment.objects.get(id=comment.id).description.description_html == "<p>旧评论</p>"


def test_sync_large_history_is_paginated_without_losing_same_timestamp_messages(laboratory):
    from plane.lab.chat_models import ChatMessage
    from plane.lab.chat_views import cursor_for

    lab = laboratory
    thread = resolve(lab)
    model = ChatThread.objects.get(id=thread["id"])
    ChatMessage.objects.bulk_create(
        [ChatMessage(thread=model, actor=lab["member"], comment_html=f"<p>{index}</p>") for index in range(450)]
    )
    stamp = timezone.now()
    ChatMessage.objects.filter(thread=model).update(created_at=stamp)
    first = ChatMessage.objects.filter(thread=model).order_by("id").first()
    start = cursor_for(first)
    values = []
    continuation = None
    while True:
        query = "?since=" + start + ("&after=" + continuation if continuation else "")
        response = page(lab, thread, query=query)
        values.extend(row["id"] for row in response["messages"])
        continuation = response["continue_cursor"]
        if not continuation:
            break
    assert len(values) == len(set(values)) == 450
