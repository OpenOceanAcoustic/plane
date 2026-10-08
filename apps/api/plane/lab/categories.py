# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
import re
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from .auth import audit, lock
from .models import Audit, PersonalCategory

# Editable initial records. legacy_key only preserves old clients' item types.
INITIAL_CATEGORIES = [
    ("project", "项目任务", "#1d4ed8"),
    ("research", "科研", "#7c3aed"),
    ("study", "学习", "#15803d"),
    ("mentoring", "带教", "#c2410c"),
]


def hex_color(value, *, automatic=False):
    if automatic and value == "":
        return ""
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValidationError("请从颜色板选择有效颜色")
    return value.lower()


def category_name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 40:
        raise ValidationError("类别名称为 1–40 字")
    return value.strip()


def category_data(row):
    return {"id": str(row.id), "name": row.name, "color": row.color, "position": row.position}


@transaction.atomic
def default_categories(user, workspace):
    lock(f"lab-categories:{workspace.id}:{user.id}")
    if not Audit.objects.filter(
        actor=user, workspace_id_snapshot=workspace.id, action="planning.categories_initialized"
    ).exists():
        PersonalCategory.objects.bulk_create(
            [
                PersonalCategory(
                    user=user, workspace=workspace, legacy_key=key, name=name, color=color, position=position
                )
                for position, (key, name, color) in enumerate(INITIAL_CATEGORIES)
            ]
        )
        audit("planning.categories_initialized", actor=user, workspace=workspace)
    return PersonalCategory.objects.filter(user=user, workspace=workspace)


def item_category(user, workspace, data, legacy_kind):
    if "category_id" in data:
        return (
            get_object_or_404(PersonalCategory, id=data["category_id"], user=user, workspace=workspace)
            if data["category_id"]
            else None
        )
    rows = default_categories(user, workspace)
    return rows.filter(legacy_key=legacy_kind).first() or rows.first()


def item_category_data(item):
    category = item.category
    return {
        "category_id": str(category.id) if category else None,
        "category_name": category.name if category else None,
        "category_color": category.color if category else None,
    }
