# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.apps import AppConfig


class LabConfig(AppConfig):
    name = "plane.lab"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from .signals import register_signals

        register_signals(self)
