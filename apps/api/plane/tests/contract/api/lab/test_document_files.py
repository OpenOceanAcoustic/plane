# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import default_storage
from django.db import connection
from django.db.models.deletion import ProtectedError
from unittest.mock import patch
from django.utils import timezone

from plane.db.models import FileAsset, Issue, Page, PageVersion, ProjectMember, ProjectPage, WorkspaceMember
from plane.lab.bounty_models import BountyTaskAccess
from .test_bounties import prepare
from .test_bounty_public_access import approve_cross, cross_member

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.contract]


@pytest.fixture
def document_storage(settings, tmp_path):
    settings.STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": str(tmp_path)},
        },
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    return tmp_path


def upload(lab, user=None, name="记录.txt", content=b"original file", **fields):
    return lab["client"](user or lab["member"]).post(
        lab["base"] + f"projects/{lab['project'].id}/documents/upload/",
        {"file": SimpleUploadedFile(name, content), **fields},
        format="multipart",
    )


def test_upload_text_keeps_original_file_and_associates_project_document(laboratory, document_storage):
    lab = laboratory
    client = lab["client"](lab["member"])
    task = Issue.objects.create(
        workspace=lab["workspace"], project=lab["project"], name="关联文件任务", state=lab["states"]["todo"]
    )
    content = "实验原文\n<script>alert('text only')</script>\n".encode()
    uploaded = client.post(
        lab["base"] + f"projects/{lab['project'].id}/documents/upload/",
        {
            "file": SimpleUploadedFile("实验记录.txt", content, content_type="text/plain"),
            "issue_id": str(task.id),
            "access": "0",
        },
        format="multipart",
    )
    assert uploaded.status_code == 201, uploaded.content
    document = uploaded.json()
    assert document["file"]["name"] == "实验记录.txt"
    assert document["file"]["extension"] == "txt"
    assert document["file"]["size"] == len(content)
    assert document["file"]["previewable"] is True
    linked = client.get(lab["base"] + f"tasks/{task.id}/documents/").json()["documents"]
    assert [row["id"] for row in linked] == [document["id"]]
    preview = client.get(lab["base"] + document["file"]["preview_path"])
    assert preview.status_code == 200
    assert preview.json() == {"text": content.decode(), "format": "txt", "filename": "实验记录.txt"}
    download = client.get(lab["base"] + document["file"]["download_path"])
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == content
    assert download["Content-Disposition"].startswith("attachment;")
    assert download["X-Content-Type-Options"] == "nosniff"


def test_document_file_native_download_requires_active_project_link(laboratory, document_storage):
    lab = laboratory
    document = upload(lab).json()
    asset = FileAsset.objects.get(page_id=document["id"])
    native = f"/api/assets/v2/workspaces/lab/download/{asset.id}/"
    client = lab["client"](lab["member"])
    with patch("plane.app.views.asset.v2.S3Storage") as storage:
        storage.return_value.generate_presigned_url.return_value = "https://storage.example.org/record"
        response = client.get(native)
        assert response.status_code == 200
        assert b"".join(response.streaming_content) == b"original file"
        ProjectPage.objects.filter(page_id=document["id"]).delete()
        assert client.get(native).status_code == 403
    assert client.get(lab["base"] + document["file"]["download_path"]).status_code == 404


def test_private_document_file_cannot_use_workspace_only_generic_download(laboratory, document_storage):
    lab = laboratory
    document = upload(lab, access="1").json()
    asset = FileAsset.objects.get(page_id=document["id"])
    outsider = lab["client"](lab["lead"])
    native = f"/api/v1/workspaces/lab/assets/{asset.id}/"
    with patch("plane.api.views.asset.S3Storage") as storage:
        storage.return_value.generate_presigned_url.return_value = "https://storage.example.org/private-record"
        assert outsider.get(native).status_code == 403
        storage.assert_not_called()


def test_bounty_shared_version_reads_original_file_and_revocation_blocks_next_read(laboratory, document_storage):
    lab = laboratory
    bounty_id, _, _ = prepare(lab)
    user = cross_member(lab)
    approve_cross(lab, bounty_id, user)
    document = upload(lab, lab["lead"], name="实验.md", content=b"# Original\n<script>plain text</script>").json()
    lead, cross = lab["client"](lab["lead"]), lab["client"](user)
    endpoint = lab["base"] + f"bounties/{bounty_id}/materials/"
    shared = lead.post(
        endpoint,
        {"kind": "document_version", "page_version_id": document["file"]["version_id"]},
        format="json",
    )
    assert shared.status_code == 201, shared.content
    detail_path = endpoint + shared.json()["id"] + "/"
    detail = cross.get(detail_path)
    assert detail.status_code == 200
    assert detail.json().get("file") is not None
    file = detail.json()["file"]
    assert file["version_id"] == document["file"]["version_id"]
    assert file["download_path"].startswith(f"bounties/{bounty_id}/materials/{shared.json()['id']}/")
    unshared = PageVersion.objects.create(
        workspace=lab["workspace"], page_id=document["id"], owned_by=lab["lead"], description_html="秘密后续版本"
    )
    native_versions = f"/api/workspaces/lab/projects/{lab['project'].id}/pages/{document['id']}/versions/{unshared.id}/"
    assert cross.get(native_versions).status_code == 403
    assert cross.get(lab["base"] + document["file"]["download_path"]).status_code == 404
    preview_path, download_path = lab["base"] + file["preview_path"], lab["base"] + file["download_path"]
    assert cross.get(preview_path).json()["text"] == "# Original\n<script>plain text</script>"
    download = cross.get(download_path)
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == b"# Original\n<script>plain text</script>"
    assert lead.delete(detail_path).status_code == 204
    assert cross.get(preview_path).status_code == 404
    assert cross.get(download_path).status_code == 404


def test_upload_rejects_filename_that_loses_extension_during_sanitization(laboratory, document_storage):
    response = upload(laboratory, name="记录..txt")
    assert response.status_code == 400
    assert not any(path.is_file() for path in document_storage.rglob("*"))


def test_non_utf8_text_keeps_original_download_and_reports_preview_encoding(laboratory, document_storage):
    lab = laboratory
    original = b"\xc4\xe3\xba\xc3"
    response = upload(lab, name="原始编码.txt", content=original)
    assert response.status_code == 201
    client = lab["client"](lab["member"])
    file = response.json()["file"]
    preview = client.get(lab["base"] + file["preview_path"])
    assert preview.status_code == 400
    assert "UTF-8" in preview.content.decode()
    download = client.get(lab["base"] + file["download_path"])
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == original


@pytest.mark.parametrize("route", ["workspace", "project", "workspace-file", "project-file", "generic", "issue-api"])
def test_native_document_download_streams_and_rechecks_revoked_membership(laboratory, document_storage, route):
    lab = laboratory
    document = upload(lab).json()
    asset = FileAsset.objects.get(page_id=document["id"])
    project = lab["project"].id
    paths = {
        "workspace": f"/api/assets/v2/workspaces/lab/download/{asset.id}/",
        "project": f"/api/assets/v2/workspaces/lab/projects/{project}/download/{asset.id}/",
        "workspace-file": f"/api/assets/v2/workspaces/lab/{asset.id}/",
        "project-file": f"/api/assets/v2/workspaces/lab/projects/{project}/{asset.id}/",
        "generic": f"/api/v1/workspaces/lab/assets/{asset.id}/",
        "issue-api": f"/api/v1/workspaces/lab/projects/{project}/work-items/{document['id']}/attachments/{asset.id}/",
    }
    client = lab["client"](lab["member"])
    with (
        patch("plane.app.views.asset.v2.S3Storage") as app_storage,
        patch("plane.api.views.asset.S3Storage") as generic_storage,
        patch("plane.api.views.issue.S3Storage") as issue_storage,
    ):
        for storage in (app_storage, generic_storage, issue_storage):
            storage.return_value.generate_presigned_url.return_value = "https://storage.example.org/record"
        response = client.get(paths[route])
        assert response.status_code == 200
        assert response["Cache-Control"] == "private, no-store"
        assert b"".join(response.streaming_content) == b"original file"
        ProjectMember.objects.filter(project=lab["project"], member=lab["member"]).update(is_active=False)
        assert client.get(paths[route]).status_code == 403


def test_native_edit_creates_new_body_version_without_overwriting_uploaded_file_version(laboratory, document_storage):
    from plane.bgtasks.page_version_task import track_page_version

    lab = laboratory
    document = upload(lab).json()
    page = Page.objects.get(id=document["id"])
    page.description_html = "<p>编辑后的正文</p>"
    page.description_json = {"type": "doc", "content": [{"type": "paragraph"}]}
    page.save()
    track_page_version.run(str(page.id), json.dumps({"description_html": "<p></p>"}), str(lab["member"].id))
    client = lab["client"](lab["member"])
    path = f"/api/workspaces/lab/projects/{lab['project'].id}/pages/{page.id}/versions/"
    versions = client.get(path).json()
    assert len(versions) == 2
    original = client.get(path + document["file"]["version_id"] + "/").json()
    assert original["description_html"] == "<p></p>"
    assert {row["id"] for row in versions} >= {document["file"]["version_id"]}


def test_version_worker_retains_original_file_and_twenty_editable_body_versions(laboratory, document_storage):
    from plane.bgtasks.page_version_task import track_page_version

    lab = laboratory
    document = upload(lab).json()
    page = Page.objects.get(id=document["id"])
    older = timezone.now() - timedelta(days=2)
    PageVersion.objects.filter(id=document["file"]["version_id"]).update(last_saved_at=older)
    for index in range(20):
        PageVersion.objects.create(
            workspace=lab["workspace"],
            page=page,
            owned_by=lab["reviewer"],
            last_saved_at=older + timedelta(hours=index + 1),
            description_html=f"<p>正文版本{index}</p>",
        )
    page.description_html = "<p>新的正文版本</p>"
    page.description_json = {"type": "doc", "content": [{"type": "paragraph"}]}
    page.save()
    track_page_version.run(str(page.id), json.dumps({"description_html": "<p>上一次正文</p>"}), str(lab["member"].id))
    client = lab["client"](lab["member"])
    path = f"/api/workspaces/lab/projects/{lab['project'].id}/pages/{page.id}/versions/"
    versions = client.get(path).json()
    assert len(versions) == 21
    assert document["file"]["version_id"] in {row["id"] for row in versions}
    assert client.get(path + versions[0]["id"] + "/").json()["description_html"] == "<p>新的正文版本</p>"
    download = client.get(lab["base"] + document["file"]["download_path"])
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == b"original file"


def test_minio_upload_download_uses_original_bytes_and_cleanup(laboratory, settings):
    assert settings.AWS_S3_ENDPOINT_URL == "http://test-minio:9000"
    lab = laboratory
    key = None
    try:
        original = b"# MinIO original\n\x00exact bytes"
        response = upload(lab, name="storage.md", content=original)
        assert response.status_code == 201, response.content
        document = response.json()
        key = FileAsset.objects.get(page_id=document["id"]).asset.name
        download = lab["client"](lab["member"]).get(lab["base"] + document["file"]["download_path"])
        assert download.status_code == 200
        assert b"".join(download.streaming_content) == original
        download.close()
    finally:
        if key:
            default_storage.delete(key)
    assert not default_storage.exists(key)


def test_minio_failed_upload_cleans_partial_object_and_database_records(laboratory, settings):
    assert settings.AWS_S3_ENDPOINT_URL == "http://test-minio:9000"
    original_save = default_storage._save
    written = []

    def write_then_fail(name, content):
        stored = original_save(name, content)
        written.append(stored)
        raise OSError("isolated storage failure after upload")

    try:
        with patch.object(default_storage, "_save", side_effect=write_then_fail):
            response = upload(laboratory, name="failure.txt")
        assert response.status_code == 503
        assert len(written) == 1
        assert not default_storage.exists(written[0])
        lab = laboratory
        assert (
            lab["client"](lab["member"])
            .get(lab["base"] + f"projects/{lab['project'].id}/documents/")
            .json()["documents"]
            == []
        )
    finally:
        for key in written:
            default_storage.delete(key)


@pytest.mark.parametrize("extension", ["txt", "md", "doc", "docx", "xls", "xlsx"])
def test_six_document_formats_preserve_original_name_and_bytes(laboratory, document_storage, extension):
    lab = laboratory
    original = (
        b"document original\x00bytes" if extension in ("txt", "md") else b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1original"
    )
    filename = f"原文件.{extension.upper()}"
    response = upload(lab, name=filename, content=original)
    assert response.status_code == 201, response.content
    file = response.json()["file"]
    assert file["name"] == filename
    assert file["extension"] == extension
    assert file["previewable"] is (extension in ("txt", "md"))
    assert (file["preview_path"] is not None) is (extension in ("txt", "md"))
    download = lab["client"](lab["member"]).get(lab["base"] + file["download_path"])
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == original


@pytest.mark.parametrize(
    "name,content", [("invalid.html", b"<script>code</script>"), ("invalid.docm", b"macro"), ("empty.txt", b"")]
)
def test_invalid_upload_does_not_create_document_or_storage_file(laboratory, document_storage, name, content):
    lab = laboratory
    assert upload(lab, name=name, content=content).status_code == 400
    assert (
        lab["client"](lab["member"]).get(lab["base"] + f"projects/{lab['project'].id}/documents/").json()["documents"]
        == []
    )
    assert not any(path.is_file() for path in document_storage.rglob("*"))


def test_size_limit_rejects_original_file_without_truncating(laboratory, document_storage, settings):
    settings.FILE_SIZE_LIMIT = 16
    assert upload(laboratory, content=b"a" * 17).status_code == 400
    assert not any(path.is_file() for path in document_storage.rglob("*"))


def test_utf8_bom_preview_removes_bom_and_keeps_original_download(laboratory, document_storage):
    lab = laboratory
    original = b"\xef\xbb\xbf# Title\n"
    response = upload(lab, name="bom.md", content=original)
    assert response.status_code == 201
    client = lab["client"](lab["member"])
    file = response.json()["file"]
    assert client.get(lab["base"] + file["preview_path"]).json()["text"] == "# Title\n"
    download = client.get(lab["base"] + file["download_path"])
    assert b"".join(download.streaming_content) == original


def test_private_document_file_is_hidden_from_other_project_members(laboratory, document_storage):
    lab = laboratory
    document = upload(lab, access="1").json()
    other = lab["client"](lab["lead"])
    project_path = lab["base"] + f"projects/{lab['project'].id}/documents/"
    assert other.get(project_path).json()["documents"] == []
    assert other.get(project_path + document["id"] + "/").status_code == 404
    assert other.get(lab["base"] + document["file"]["preview_path"]).status_code == 404
    assert other.get(lab["base"] + document["file"]["download_path"]).status_code == 404


@pytest.mark.parametrize("flag", ["deleted_at", "is_deleted", "is_archived", "is_uploaded"])
def test_inactive_file_asset_cannot_be_previewed_or_downloaded(laboratory, document_storage, flag):
    lab = laboratory
    document = upload(lab).json()
    value = timezone.now() if flag == "deleted_at" else flag != "is_uploaded"
    FileAsset.objects.filter(page_id=document["id"]).update(**{flag: value})
    client = lab["client"](lab["member"])
    assert client.get(lab["base"] + document["file"]["preview_path"]).status_code == 404
    assert client.get(lab["base"] + document["file"]["download_path"]).status_code == 404


def test_issue_api_document_download_requires_current_workspace_membership(laboratory, document_storage):
    lab = laboratory
    document = upload(lab).json()
    asset = FileAsset.objects.get(page_id=document["id"])
    WorkspaceMember.objects.filter(workspace=lab["workspace"], member=lab["member"]).update(is_active=False)
    path = f"/api/v1/workspaces/lab/projects/{lab['project'].id}/work-items/{document['id']}/attachments/{asset.id}/"
    assert lab["client"](lab["member"]).get(path).status_code == 403


def test_revoking_task_access_blocks_shared_original_file(laboratory, document_storage):
    lab = laboratory
    bounty_id, _, _ = prepare(lab)
    user = cross_member(lab)
    allocation_id = approve_cross(lab, bounty_id, user)
    document = upload(lab, lab["lead"]).json()
    endpoint = lab["base"] + f"bounties/{bounty_id}/materials/"
    shared = lab["client"](lab["lead"]).post(
        endpoint, {"kind": "document_version", "page_version_id": document["file"]["version_id"]}, format="json"
    )
    assert shared.status_code == 201
    client = lab["client"](user)
    file = client.get(endpoint + shared.json()["id"] + "/").json()["file"]
    assert client.get(lab["base"] + file["preview_path"]).status_code == 200
    BountyTaskAccess.objects.filter(allocation_id=allocation_id).update(revoked_at=timezone.now())
    assert client.get(lab["base"] + file["preview_path"]).status_code == 403
    assert client.get(lab["base"] + file["download_path"]).status_code == 403


def test_removing_project_document_link_blocks_shared_original_file(laboratory, document_storage):
    lab = laboratory
    bounty_id, _, _ = prepare(lab)
    user = cross_member(lab)
    approve_cross(lab, bounty_id, user)
    document = upload(lab, lab["lead"]).json()
    endpoint = lab["base"] + f"bounties/{bounty_id}/materials/"
    shared = lab["client"](lab["lead"]).post(
        endpoint, {"kind": "document_version", "page_version_id": document["file"]["version_id"]}, format="json"
    )
    assert shared.status_code == 201
    client = lab["client"](user)
    detail_path = endpoint + shared.json()["id"] + "/"
    file = client.get(detail_path).json()["file"]
    assert client.get(lab["base"] + file["preview_path"]).status_code == 200
    download = client.get(lab["base"] + file["download_path"])
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == b"original file"
    ProjectPage.objects.filter(project=lab["project"], page_id=document["id"]).delete()
    assert client.get(detail_path).status_code == 404
    assert client.get(lab["base"] + file["preview_path"]).status_code == 404
    assert client.get(lab["base"] + file["download_path"]).status_code == 404


def test_file_version_hard_delete_cannot_remove_native_access_guard(laboratory, document_storage):
    lab = laboratory
    document = upload(lab).json()
    version = PageVersion.objects.get(id=document["file"]["version_id"])
    asset = FileAsset.objects.get(page_id=document["id"])
    with pytest.raises(ProtectedError):
        version.delete(soft=False)
    version.delete()
    client = lab["client"](lab["member"])
    assert client.get(lab["base"] + document["file"]["download_path"]).status_code == 404
    assert client.get(f"/api/v1/workspaces/lab/assets/{asset.id}/").status_code == 403


def test_database_failure_after_storage_upload_cleans_file_and_document(laboratory, document_storage):
    lab = laboratory
    with connection.cursor() as cursor:
        cursor.execute("""
            CREATE FUNCTION document_file_contract_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'isolated document database failure'; END $$;
            CREATE TRIGGER document_file_contract_failure BEFORE INSERT ON lab_documentfileversion
            FOR EACH ROW EXECUTE FUNCTION document_file_contract_failure();
        """)
    try:
        client = lab["client"](lab["member"])
        client.raise_request_exception = False
        response = client.post(
            lab["base"] + f"projects/{lab['project'].id}/documents/upload/",
            {"file": SimpleUploadedFile("rollback.txt", b"uploaded before database failure")},
            format="multipart",
        )
        assert response.status_code == 500
        assert client.get(lab["base"] + f"projects/{lab['project'].id}/documents/").json()["documents"] == []
        assert not any(path.is_file() for path in document_storage.rglob("*"))
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER document_file_contract_failure ON lab_documentfileversion")
            cursor.execute("DROP FUNCTION document_file_contract_failure()")
