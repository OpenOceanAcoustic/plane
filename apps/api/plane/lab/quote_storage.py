# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from plane.settings.storage import S3Storage


class PrivateQuoteStorage(S3Storage):
    """Quote evidence never inherits the native assets' public-read ACL."""

    def get_object_parameters(self, name):
        return {**super().get_object_parameters(name), "ACL": "private"}

    def url(self, name, **kwargs):
        raise ValueError("Quote evidence must be downloaded through its authorized endpoint")
