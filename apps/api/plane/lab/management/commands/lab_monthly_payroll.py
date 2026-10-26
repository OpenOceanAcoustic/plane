# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
import json
from django.core.management.base import BaseCommand
from plane.lab.monthly_payroll import run_due_payrolls


class Command(BaseCommand):
    help = "Run enabled, due month-end payroll schedules without making payments."

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(run_due_payrolls(), ensure_ascii=False))
