# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from plane.db.models import FileAsset, PageVersion
from .auth import audit
from .bounty_access import bounty_access
from .bounties import locked_bounty
from .bounty_models import BountyMaterial
from .documents import accessible_pages, page_access
from .document_files import available_file, file_data, file_response
from .document_models import DocumentFileVersion
from .permissions import require_lead
from .planning_views import LabView


def material_data(material):
    return {
        "id": str(material.id),
        "kind": material.kind,
        "label": material.label,
        "shared_at": material.created_at.isoformat(),
        "revoked_at": material.revoked_at.isoformat() if material.revoked_at else None,
        "page_version_id": str(material.page_version_id) if material.page_version_id else None,
        # Deliberately return no native asset URL or attachment identifier.
    }


def shared_document_file(material, bounty):
    if material.kind != "document_version" or not material.page_version_id:
        return None
    row = (
        DocumentFileVersion.objects.select_related("page_version__page", "asset")
        .filter(page_version_id=material.page_version_id)
        .first()
    )
    if row and not available_file(
        row, bounty.stage.project.workspace, material.page_version.page_id, bounty.stage.project_id
    ):
        from django.http import Http404

        raise Http404()
    return row


class BountyMaterialsView(LabView):
    def get(self, request, slug, pk):
        bounty = bounty_access(request.user, self.workspace, pk, execution=True)
        materials = bounty.materials.filter(revoked_at__isnull=True).order_by("created_at")
        response = {"materials": [material_data(row) for row in materials]}
        if request.query_params.get("sources") == "1":
            require_lead(request.user, bounty.stage.project)
            pages = accessible_pages(request.user, self.workspace, bounty.stage.project_id)
            versions = PageVersion.objects.filter(workspace=self.workspace, page__in=pages).select_related("page")
            attachments = (
                FileAsset.objects.filter(
                    workspace=self.workspace,
                    issue_id=bounty.issue_id,
                    project_id=bounty.stage.project_id,
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                    is_uploaded=True,
                    is_deleted=False,
                    is_archived=False,
                )
                if bounty.issue_id
                else FileAsset.objects.none()
            )
            response["sources"] = {
                "document_versions": [
                    {"id": str(row.id), "name": row.page.name, "created_at": row.created_at.isoformat()}
                    for row in versions[:200]
                ],
                "attachments": [
                    {"id": str(row.id), "name": row.attributes.get("name", "附件")} for row in attachments[:200]
                ],
            }
        return Response(response)

    @transaction.atomic
    def post(self, request, slug, pk):
        bounty = bounty_access(request.user, self.workspace, pk, execution=True)
        bounty = locked_bounty(bounty.id)
        require_lead(request.user, bounty.stage.project)
        if bounty.status == "deleted":
            raise ValidationError("悬赏已删除")
        kind = request.data.get("kind")
        snapshot, version, attachment, attachment_key = {}, None, None, ""
        if kind == "document_version":
            version = get_object_or_404(PageVersion, id=request.data.get("page_version_id"), workspace=self.workspace)
            page, _ = page_access(request.user, self.workspace, bounty.stage.project_id, version.page_id)
            snapshot = {
                "name": page.name,
                "description_html": version.description_html,
                "description_json": version.description_json,
                "created_at": version.created_at.isoformat(),
            }
            default_label = page.name or "实验文档版本"
        elif kind == "attachment":
            if not bounty.issue_id:
                raise ValidationError("原任务已删除，不能共享附件")
            attachment = get_object_or_404(
                FileAsset,
                id=request.data.get("attachment_id"),
                workspace=self.workspace,
                project_id=bounty.stage.project_id,
                issue_id=bounty.issue_id,
                entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                is_uploaded=True,
                is_deleted=False,
                is_archived=False,
            )
            attachment_key = attachment.asset.name
            default_label = attachment.attributes.get("name") or "任务附件"
        else:
            raise ValidationError("请选择指定文档版本或任务附件")
        label = str(request.data.get("label") or default_label).strip()
        if not label or len(label) > 255:
            raise ValidationError("资料名称为 1–255 字")
        existing = BountyMaterial.objects.filter(
            bounty=bounty,
            kind=kind,
            page_version=version,
            attachment=attachment,
            revoked_at__isnull=True,
        ).first()
        if existing:
            return Response(material_data(existing))
        material = BountyMaterial.objects.create(
            bounty=bounty,
            kind=kind,
            label=label,
            page_version=version,
            attachment=attachment,
            attachment_key=attachment_key,
            document_snapshot=snapshot,
            shared_by=request.user,
        )
        audit(
            "bounty.material_shared",
            material,
            request.user,
            self.workspace,
            bounty_id=str(bounty.id),
            kind=kind,
            label=label,
        )
        return Response(material_data(material), status=201)


class BountyMaterialDetailView(LabView):
    def get(self, request, slug, pk, material_id):
        bounty = bounty_access(request.user, self.workspace, pk, execution=True)
        material = get_object_or_404(
            BountyMaterial.objects.select_related("page_version__page", "attachment"),
            bounty=bounty,
            id=material_id,
            revoked_at__isnull=True,
        )
        if material.kind == "document_version":
            if (
                not material.page_version_id
                or material.page_version.deleted_at
                or material.page_version.page.deleted_at
            ):
                from django.http import Http404

                raise Http404()
            document_file = shared_document_file(material, bounty)
            prefix = f"bounties/{bounty.id}/materials/{material.id}/"
            return Response(
                {
                    **material_data(material),
                    **material.document_snapshot,
                    "file": file_data(document_file, bounty.stage.project_id, prefix=prefix),
                }
            )
        attachment = material.attachment
        if (
            not attachment
            or attachment.deleted_at
            or attachment.is_deleted
            or attachment.is_archived
            or not attachment.is_uploaded
            or attachment.asset.name != material.attachment_key
            or attachment.workspace_id != self.workspace.id
            or attachment.issue_id != bounty.issue_id
        ):
            from django.http import Http404

            raise Http404()
        try:
            stream = attachment.asset.storage.open(material.attachment_key, "rb")
        except (FileNotFoundError, OSError):
            from django.http import Http404

            raise Http404()
        response = FileResponse(
            stream, as_attachment=True, filename=material.label, content_type="application/octet-stream"
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @transaction.atomic
    def delete(self, request, slug, pk, material_id):
        bounty = bounty_access(request.user, self.workspace, pk, execution=True)
        require_lead(request.user, bounty.stage.project)
        material = get_object_or_404(BountyMaterial.objects.select_for_update(), bounty=bounty, id=material_id)
        if not material.revoked_at:
            material.revoked_at = timezone.now()
            material.save(update_fields=["revoked_at"])
            audit("bounty.material_revoked", material, request.user, self.workspace, bounty_id=str(bounty.id))
        return Response(status=204)


class BountyMaterialFileView(LabView):
    def get(self, request, slug, pk, material_id, preview=False):
        from django.http import Http404

        bounty = bounty_access(request.user, self.workspace, pk, execution=True)
        material = get_object_or_404(
            BountyMaterial.objects.select_related("page_version__page"),
            bounty=bounty,
            id=material_id,
            revoked_at__isnull=True,
        )
        document_file = shared_document_file(material, bounty)
        if not document_file:
            raise Http404()
        return file_response(document_file, preview=preview)
