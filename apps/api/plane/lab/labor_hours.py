# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Bounded decimal work-hour multiplication and explicit work periods."""

import re
from datetime import date, timedelta
from decimal import Decimal
from rest_framework.exceptions import ValidationError


def work_hours(value, start, end=None):
    if not isinstance(value, str):
        raise ValidationError("工时须为数字或天数×每日小时，例如5×8")
    expression = re.sub(r"\s+", "", value)
    match = re.fullmatch(r"([0-9]{1,3})[xX*×]([0-9]{1,2}(?:\.[0-9]{1,2})?)", expression)
    hint = 1
    if match:
        hint, daily = int(match[1]), Decimal(match[2])
        if not 1 <= hint <= 366 or not 0 < daily <= 24:
            raise ValidationError("工时乘法的天数须为1至366，每日工时须大于0且不超过24")
        hours = hint * daily
    elif re.fullmatch(r"[0-9]{1,4}(?:\.[0-9]{1,2})?", expression):
        hours = Decimal(expression)
    else:
        raise ValidationError("工时须为数字或天数×每日小时，例如5×8")
    first = date.fromisoformat(start)
    if end is not None and end != "" and (not isinstance(end, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end)):
        raise ValidationError("工时结束日期无效")
    try:
        last = date.fromisoformat(end) if end else first + timedelta(days=hint - 1)
    except (ValueError, OverflowError):
        raise ValidationError("工时结束日期无效")
    count = (last - first).days + 1
    if not 1 <= count <= 366 or count < hint:
        raise ValidationError("工时期间须为1至366天，且不能短于乘法填写的天数")
    if not 0 < hours <= count * 24:
        raise ValidationError("工时须大于0，每日劳动工时不能超过24小时")
    return hours, last.isoformat(), expression


def daily_hours(data):
    first = date.fromisoformat(data["date"])
    last = date.fromisoformat(data.get("end_date") or data["date"])
    count = (last - first).days + 1
    units = int(Decimal(data["hours"]) * 100)
    base, remainder = divmod(units, count)
    return {
        (first + timedelta(days=offset)).isoformat(): Decimal(base + (offset < remainder)) / 100
        for offset in range(count)
    }
