# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Private conversation images use the existing FileAsset storage and editor nodes."""

import logging
import uuid
import warnings
from io import BytesIO

from bs4 import BeautifulSoup
from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse, Http404
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from plane.app.views.asset.access import native_asset_access
from plane.db.models import FileAsset
from plane.utils.path_validator import sanitize_filename
from .chat import identifier, thread_access
from .chat_models import ChatImage
from .planning_views import LabView

logger = logging.getLogger(__name__)
IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "GIF": "image/gif", "WEBP": "image/webp"}


class ChatImageStorageError(APIException):
    status_code = 503
    default_detail = "图片存储暂不可用，请重试"


def image_ids(soup):
    return {identifier(node.get("src")) for node in soup.find_all(["img", "image-component"])}


def validate_images(user, thread, soup, message_id=None, bind=False):
    ids = image_ids(soup)
    rows = ChatImage.objects.select_related("asset").filter(
        thread=thread,
        asset_id__in=ids,
        asset__workspace_id=thread.workspace_id,
        asset__is_uploaded=True,
        asset__is_deleted=False,
        asset__is_archived=False,
        asset__deleted_at__isnull=True,
    )
    if bind:
        rows = rows.select_for_update()
    found = list(rows)
    if len(found) != len(ids) or any(
        (row.message_id is not None and row.message_id != message_id)
        or (row.message_id is None and row.asset.created_by_id != user.id)
        for row in found
    ):
        raise ValidationError("图片尚未上传成功或不属于当前消息")
    for node in soup.find_all(["img", "image-component"]):
        node.name = "image-component"
        node["src"] = str(identifier(node.get("src")))
        node["status"] = "uploaded"
    if bind:
        ChatImage.objects.filter(id__in=[row.id for row in found]).update(message_id=message_id)


def bind_images(user, thread, message):
    validate_images(user, thread, BeautifulSoup(message.comment_html, "html.parser"), message.id, bind=True)


def readable_image(user, thread, asset_id):
    row = (
        ChatImage.objects.select_related("asset", "message")
        .filter(
            thread=thread,
            asset_id=asset_id,
            asset__workspace_id=thread.workspace_id,
            asset__is_uploaded=True,
            asset__is_deleted=False,
            asset__is_archived=False,
            asset__deleted_at__isnull=True,
        )
        .first()
    )
    if not row:
        raise NotFound("图片不可访问")
    if row.message_id:
        if (
            row.message.deleted_at
            or row.message.thread_id != thread.id
            or row.asset_id not in image_ids(BeautifulSoup(row.message.comment_html, "html.parser"))
        ):
            raise NotFound("图片不可访问")
    elif row.asset.created_by_id != user.id:
        raise NotFound("图片不可访问")
    return row.asset


def store_image(user, thread, filename, content):
    if not content or len(content) > settings.FILE_SIZE_LIMIT:
        raise ValidationError("图片为空或超过上传大小上限")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                content_type = IMAGE_TYPES.get(image.format)
                image.verify()
        if not content_type:
            raise ValueError()
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise ValidationError("仅支持有效的 JPEG、PNG、WebP 和 GIF 图片") from None
    filename = (sanitize_filename(filename) or "image")[:255]
    asset = FileAsset(
        workspace=thread.workspace,
        project_id=thread.project_id,
        entity_type="CHAT_IMAGE",
        attributes={"name": filename, "type": content_type, "size": len(content)},
        size=len(content),
        is_uploaded=True,
    )
    storage = asset.asset.storage
    key = f"chat-images/{thread.workspace_id}/{uuid.uuid4().hex}-{filename}"
    try:
        with transaction.atomic():
            payload = ContentFile(content, name=filename)
            payload.content_type = content_type
            try:
                key = storage.save(key, payload)
            except Exception:
                logger.exception("Failed to store chat image")
                raise ChatImageStorageError() from None
            asset.asset.name = key
            asset.save(created_by_id=user.id)
            ChatImage.objects.create(thread=thread, asset=asset)
    except Exception:
        try:
            storage.delete(key)
        except Exception:
            logger.exception("Failed to clean up rejected chat image")
        raise
    return {"asset_id": str(asset.id)}


class ChatImagesView(LabView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, slug, thread_id):
        from .security import enforce_user_limits

        thread = thread_access(request.user, self.workspace, thread_id, write=True)
        enforce_user_limits(request, category="upload")
        if thread.scope == "issue":
            raise ValidationError("工作项图片请使用原评论上传接口")
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError("请选择图片")
        data = store_image(request.user, thread, uploaded.name, uploaded.read(settings.FILE_SIZE_LIMIT + 1))
        return Response(data, status=201)


class ChatImageView(LabView):
    def get(self, request, slug, thread_id, asset_id):
        thread = thread_access(request.user, self.workspace, thread_id)
        asset = readable_image(request.user, thread, asset_id)
        try:
            stream = asset.asset.open("rb")
        except (OSError, FileNotFoundError):
            raise Http404() from None
        response = FileResponse(
            stream,
            as_attachment=request.query_params.get("download") == "1",
            filename=asset.attributes["name"],
            content_type=asset.attributes["type"],
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class ChatImageDuplicateView(LabView):
    def post(self, request, slug, thread_id, asset_id):
        from .security import enforce_user_limits

        thread = thread_access(request.user, self.workspace, thread_id, write=True)
        enforce_user_limits(request, category="upload")
        if thread.scope == "issue":
            raise ValidationError("工作项图片请使用原评论上传接口")
        source = FileAsset.objects.filter(
            id=asset_id, workspace=self.workspace, is_uploaded=True, is_deleted=False, is_archived=False
        ).first()
        if not source:
            raise NotFound("图片不可访问")
        if source.entity_type == "CHAT_IMAGE":
            original = ChatImage.objects.filter(asset=source).first()
            if not original:
                raise NotFound("图片不可访问")
            source_thread = thread_access(request.user, self.workspace, original.thread_id)
            readable_image(request.user, source_thread, source.id)
        elif not native_asset_access(request.user, source):
            raise NotFound("图片不可访问")
        try:
            with source.asset.open("rb") as stream:
                content = stream.read(settings.FILE_SIZE_LIMIT + 1)
        except OSError:
            raise Http404() from None
        return Response(store_image(request.user, thread, source.attributes.get("name"), content), status=201)
