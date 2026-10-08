# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only


def csv_cell(value):
    """Neutralize spreadsheet formulas in names, descriptions, and snapshots."""
    value = str(value if value is not None else "")
    return "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r")) else value
