# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import logging
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from plane.utils.path_validator import sanitize_filename
from . import bounties, quotes
from .bounty_access import bounty_access
from .models import BountyQuoteAttachment
from .planning_views import LabView
from .quote_views import attachment_data

logger = logging.getLogger(__name__)


class QuoteStorageError(APIException):
    status_code = 503
    default_detail = "附件存储暂不可用，请重试"


class BountyQuoteUploadView(LabView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, slug, pk):
        from .security import enforce_user_limits

        enforce_user_limits(request, category="upload")
        bounty = bounty_access(request.user, self.workspace, pk)
        quotes.eligible_applicant(request.user, bounty)
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError("请选择附件")
        name = sanitize_filename(uploaded.name)
        if not name or len(name) > 255:
            raise ValidationError("附件名称须为 1–255 字")
        content = uploaded.read(settings.FILE_SIZE_LIMIT + 1)
        if not content or len(content) > settings.FILE_SIZE_LIMIT:
            raise ValidationError("附件为空或超过文件大小限制")
        storage = storages["lab_quotes"]
        key = None
        try:
            with transaction.atomic():
                bounty = bounties.locked_bounty(bounty.id)
                quotes.eligible_applicant(request.user, bounty)
                if not quotes.can_apply(request.user, bounty):
                    raise ValidationError("已有待处理申请")
                try:
                    key = storage.save(f"lab-quotes/{self.workspace.id}/{uuid.uuid4().hex}", ContentFile(content))
                except Exception:
                    logger.exception("Failed to store quote evidence")
                    raise QuoteStorageError() from None
                row = BountyQuoteAttachment.objects.create(
                    bounty=bounty,
                    user=request.user,
                    name=name,
                    size=len(content),
                    storage_key=key,
                )
        except Exception:
            if key:
                try:
                    storage.delete(key)
                except Exception:
                    logger.exception("Failed to clean up rejected quote evidence")
            raise
        return Response(attachment_data(row), status=201)


class BountyQuoteDownloadView(LabView):
    def get(self, request, slug, pk, attachment_id):
        bounty = bounty_access(request.user, self.workspace, pk)
        row = get_object_or_404(BountyQuoteAttachment.objects.select_related("quote"), bounty=bounty, id=attachment_id)
        if row.quote_id:
            row.quote.bounty = bounty
            quotes.require_quote_access(request.user, row.quote)
        elif row.user_id != request.user.id:
            raise Http404()
        try:
            stream = storages["lab_quotes"].open(row.storage_key, "rb")
        except (OSError, FileNotFoundError):
            raise Http404() from None
        response = FileResponse(stream, as_attachment=True, filename=row.name, content_type="application/octet-stream")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
