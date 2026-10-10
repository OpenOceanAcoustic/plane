# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import logging
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError as FileValidationError
from django.core.files.base import ContentFile
from django.core.validators import FileExtensionValidator
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from plane.db.models import FileAsset, Page, PageVersion, ProjectPage, WorkspaceMember
from plane.utils.path_validator import sanitize_filename

from .auth import audit
from .document_models import DocumentFileVersion, TaskDocumentLink
from .permissions import issue_access
from .planning_views import LabView


logger = logging.getLogger(__name__)
FILE_TYPES = {
    "txt": "text/plain",
    "md": "text/markdown",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
TEXT_TYPES = {"txt", "md"}


class DocumentStorageError(APIException):
    status_code = 503
    default_detail = "文件存储暂不可用，请重试"


def files_for_pages(pages):
    rows = (
        DocumentFileVersion.objects.filter(
            page_version__page_id__in=[page.id for page in pages],
            page_version__deleted_at__isnull=True,
            asset__deleted_at__isnull=True,
            asset__is_deleted=False,
            asset__is_archived=False,
            asset__is_uploaded=True,
        )
        .select_related("page_version", "asset")
        .order_by("-page_version__created_at", "-page_version_id")
    )
    result = {}
    for row in rows:
        result.setdefault(row.page_version.page_id, row)
    return result


def file_data(row, project_id, prefix=None):
    if not row:
        return None
    prefix = prefix or (f"projects/{project_id}/documents/{row.page_version.page_id}/versions/{row.page_version_id}/")
    return {
        "name": row.name,
        "extension": row.extension,
        "content_type": row.content_type,
        "size": row.size,
        "version_id": str(row.page_version_id),
        "previewable": row.extension in TEXT_TYPES,
        "download_path": prefix + "download/",
        "preview_path": prefix + "preview/" if row.extension in TEXT_TYPES else None,
    }


def available_file(row, workspace, page_id, project_id=None):
    asset, version = row.asset, row.page_version
    return bool(
        not row.deleted_at
        and not version.deleted_at
        and not version.page.deleted_at
        and version.workspace_id == workspace.id
        and version.page.workspace_id == workspace.id
        and version.page_id == page_id
        and not asset.deleted_at
        and not asset.is_deleted
        and not asset.is_archived
        and asset.is_uploaded
        and asset.workspace_id == workspace.id
        and asset.page_id == page_id
        and (project_id is None or asset.project_id == project_id)
        and asset.asset.name == row.asset_key
        and (
            project_id is None
            or ProjectPage.objects.filter(workspace=workspace, project_id=project_id, page_id=page_id).exists()
        )
    )


def native_document_asset_access(user, asset):
    """Keep every native asset route inside the original document's current ACL."""
    from .documents import page_access

    row = (
        DocumentFileVersion.all_objects.select_related("page_version__page", "asset").filter(asset_id=asset.id).first()
    )
    if not row:
        return True
    if not asset.workspace_id or not asset.project_id or not asset.page_id:
        return False
    if not WorkspaceMember.objects.filter(member=user, workspace_id=asset.workspace_id, is_active=True).exists():
        return False
    if not available_file(row, asset.workspace, asset.page_id, asset.project_id):
        return False
    try:
        page_access(user, asset.workspace, asset.project_id, asset.page_id)
    except (APIException, Http404):
        return False
    return True


def native_document_file_response(user, asset):
    row = (
        DocumentFileVersion.all_objects.select_related("page_version__page", "asset").filter(asset_id=asset.id).first()
    )
    if not row:
        return None
    if not native_document_asset_access(user, asset):
        return Response({"error": "You don't have access to this asset."}, status=403)
    return file_response(row)


def private_response(response):
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def file_response(row, preview=False):
    if preview and row.extension not in TEXT_TYPES:
        raise ValidationError("该文件仅支持下载原文件")
    try:
        stream = row.asset.asset.storage.open(row.asset_key, "rb")
    except (FileNotFoundError, OSError):
        raise Http404() from None
    if not preview:
        return private_response(
            FileResponse(stream, as_attachment=True, filename=row.name, content_type="application/octet-stream")
        )
    try:
        with stream:
            text = stream.read(row.size + 1).decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValidationError("TXT 和 MD 文件须为 UTF-8 编码") from None
    return private_response(Response({"text": text, "format": row.extension, "filename": row.name}))


class ProjectDocumentDetailView(LabView):
    def get(self, request, slug, project_id, page_id):
        from .documents import document_data, page_access

        page, _ = page_access(request.user, self.workspace, project_id, page_id)
        return Response(document_data(page, project_id))


class ProjectDocumentFileView(LabView):
    def get(self, request, slug, project_id, page_id, version_id, preview=False):
        from .documents import page_access

        page_access(request.user, self.workspace, project_id, page_id)
        row = get_object_or_404(
            DocumentFileVersion.objects.select_related("asset", "page_version__page"),
            page_version_id=version_id,
            page_version__page_id=page_id,
        )
        if not available_file(row, self.workspace, page_id, project_id):
            raise Http404()
        return file_response(row, preview=preview)


class ProjectDocumentUploadView(LabView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, slug, project_id):
        from .documents import document_data, project_membership

        project_membership(request.user, self.workspace, project_id, edit=True)
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError("请选择上传文档")
        filename = sanitize_filename(uploaded.name)
        if not filename or len(filename) > 255:
            raise ValidationError("文件名称为 1–255 字")
        uploaded.name = filename
        try:
            FileExtensionValidator(allowed_extensions=list(FILE_TYPES))(uploaded)
        except FileValidationError:
            raise ValidationError("仅支持 TXT、MD、Word 和 Excel 文档") from None
        extension = filename.rsplit(".", 1)[-1].lower()
        content = uploaded.read(settings.FILE_SIZE_LIMIT + 1)
        if not content or len(content) > settings.FILE_SIZE_LIMIT:
            raise ValidationError("文件为空或超过上传大小上限")
        name = str(request.data.get("name") or filename).strip()
        if not name or len(name) > 255:
            raise ValidationError("文档名称为 1–255 字")
        access = request.data.get("access", "0")
        if access not in ("0", "1", 0, 1) or isinstance(access, bool):
            raise ValidationError("请选择公开或私人文档")
        issue = None
        if request.data.get("issue_id"):
            issue = issue_access(request.user, self.workspace, request.data["issue_id"], edit=True)
            if str(issue.project_id) != str(project_id):
                raise ValidationError("任务与文档必须属于同一项目")
        description_json = {"type": "doc", "content": [{"type": "paragraph"}]}
        description_html = "<p></p>"
        storage, stored_key = None, None
        try:
            with transaction.atomic():
                page = Page.objects.create(
                    workspace=self.workspace,
                    owned_by=request.user,
                    name=name,
                    access=int(access),
                    description_html=description_html,
                    description_json=description_json,
                )
                ProjectPage.objects.create(workspace=self.workspace, project_id=project_id, page=page)
                version = PageVersion.objects.create(
                    workspace=self.workspace,
                    owned_by=request.user,
                    page=page,
                    description_html=description_html,
                    description_json=description_json,
                )
                asset = FileAsset(
                    workspace=self.workspace,
                    project_id=project_id,
                    page=page,
                    entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
                    attributes={"name": filename, "type": FILE_TYPES[extension], "size": len(content)},
                    size=len(content),
                    is_uploaded=True,
                )
                storage = asset.asset.storage
                stored_key = f"{self.workspace.id}/{uuid.uuid4().hex}-{filename}"
                file_content = ContentFile(content, name=filename)
                file_content.content_type = FILE_TYPES[extension]
                try:
                    stored_key = storage.save(stored_key, file_content)
                except Exception:
                    logger.exception("Failed to store document upload")
                    raise DocumentStorageError() from None
                asset.asset.name = stored_key
                asset.save(created_by_id=request.user.id)
                document_file = DocumentFileVersion.objects.create(
                    page_version=version,
                    asset=asset,
                    name=filename,
                    extension=extension,
                    content_type=FILE_TYPES[extension],
                    size=len(content),
                    sha256=hashlib.sha256(content).hexdigest(),
                    asset_key=stored_key,
                )
                if issue:
                    TaskDocumentLink.objects.create(workspace=self.workspace, issue=issue, page=page)
                audit("document.file_uploaded", page, request.user, self.workspace, project_id=str(project_id))
                data = document_data(page, project_id, document_files={page.id: document_file})
        except Exception:
            if storage and stored_key:
                try:
                    storage.delete(stored_key)
                except Exception:
                    logger.exception("Failed to clean up a rejected document upload")
            raise
        return Response(data, status=201)
