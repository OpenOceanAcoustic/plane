# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Compare restored object-store files to the quiesced backup archive."""

import hashlib
from pathlib import Path
import tarfile

root = Path("/restored").resolve()
count = 0
with tarfile.open("/backup/attachments.tar.gz", "r:gz") as archive:
    for member in archive:
        if not member.isfile():
            continue
        destination = (root / member.name).resolve()
        if not destination.is_relative_to(root):
            raise SystemExit("附件备份包含无效路径")
        with archive.extractfile(member) as expected, destination.open("rb") as actual:
            if (
                hashlib.file_digest(expected, "sha256").digest()
                != hashlib.file_digest(actual, "sha256").digest()
            ):
                raise SystemExit("附件恢复校验失败")
        count += 1
print("Restored attachment files verified:", count)
