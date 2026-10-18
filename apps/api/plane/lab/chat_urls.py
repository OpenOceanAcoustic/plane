# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path
from .chat_views import (
    ChatThreadsView,
    ChatThreadView,
    ChatMessagesView,
    ChatMessageView,
    ChatReadView,
    ChatReferencesView,
    ChatResolveReferencesView,
)
from .chat_images import ChatImagesView, ChatImageView, ChatImageDuplicateView

chat_patterns = [
    path("chat/threads/", ChatThreadsView.as_view()),
    path("chat/references/", ChatResolveReferencesView.as_view()),
    path("chat/threads/<uuid:thread_id>/", ChatThreadView.as_view()),
    path("chat/threads/<uuid:thread_id>/messages/", ChatMessagesView.as_view()),
    path("chat/threads/<uuid:thread_id>/images/", ChatImagesView.as_view()),
    path("chat/threads/<uuid:thread_id>/images/<uuid:asset_id>/", ChatImageView.as_view()),
    path("chat/threads/<uuid:thread_id>/images/<uuid:asset_id>/duplicate/", ChatImageDuplicateView.as_view()),
    path("chat/threads/<uuid:thread_id>/messages/<uuid:message_id>/", ChatMessageView.as_view()),
    path("chat/threads/<uuid:thread_id>/read/", ChatReadView.as_view()),
    path("chat/threads/<uuid:thread_id>/references/", ChatReferencesView.as_view()),
]
