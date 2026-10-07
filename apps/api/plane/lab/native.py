# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from contextlib import contextmanager

from django.db import IntegrityError, transaction


@contextmanager
def optional_issue_relation():
    """Keep native duplicate tolerance without swallowing lab constraints."""
    try:
        with transaction.atomic():
            yield
    except IntegrityError as error:
        if "lab_" in str(error):
            raise
