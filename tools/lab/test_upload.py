# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Verify a project cover's signed upload and download through the real proxy.

Run inside the API container with this file on stdin. Only a unique temporary
object is written; it is deleted on both success and failure. Signed fields and
URLs stay in memory and are never printed.
"""

import base64
from urllib.parse import urlsplit, urlunsplit
import uuid

import django
import requests

from django.conf import settings
from django.test import RequestFactory

from plane.settings.storage import S3Storage


def proxy_url(signed_url):
    parsed = urlsplit(signed_url)
    return urlunsplit(("http", "proxy:80", parsed.path, parsed.query, ""))


def main():
    django.setup()
    from django.contrib.auth.models import AnonymousUser

    origin = urlsplit(settings.WEB_URL)
    request = RequestFactory().post(
        "/", HTTP_HOST=origin.netloc, secure=origin.scheme == "https"
    )
    request.user = AnonymousUser()
    public_storage = S3Storage(request=request)
    internal_storage = S3Storage()
    key = f"upload-contract/{uuid.uuid4().hex}.png"
    content = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
        "/x8AAwMCAO+aE1kAAAAASUVORK5CYII="
    )
    with requests.Session() as client:
        client.trust_env = False
        # localhost in WEB_URL is the host machine, not this API container.
        # Reach Caddy over Docker DNS but preserve the Host bound to the signature.
        client.headers["Host"] = origin.netloc
        try:
            signed = public_storage.generate_presigned_post(
                key, "image/png", len(content), expiration=60
            )
            response = client.post(
                proxy_url(signed["url"]),
                data=signed["fields"],
                files={"file": ("cover.png", content, "image/png")},
                timeout=10,
            )
            if response.status_code not in (200, 201, 204):
                raise SystemExit(
                    f"Project cover upload failed: HTTP {response.status_code}"
                )
            download = client.get(
                proxy_url(public_storage.generate_presigned_url(key, expiration=60)),
                timeout=10,
            )
            if download.status_code != 200 or download.content != content:
                raise SystemExit("Uploaded project cover could not be read back")
            print("Project cover upload and download through the proxy passed.")
        except requests.RequestException:
            raise SystemExit(
                "Could not connect to the project cover storage endpoint"
            ) from None
        finally:
            internal_storage.s3_client.delete_object(
                Bucket=internal_storage.aws_storage_bucket_name, Key=key
            )


if __name__ == "__main__":
    main()
