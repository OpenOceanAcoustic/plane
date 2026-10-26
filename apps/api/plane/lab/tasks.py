# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
from celery import shared_task


@shared_task(name="plane.lab.tasks.generate_due_payrolls")
def generate_due_payrolls():
    from .monthly_payroll import run_due_payrolls

    return run_due_payrolls()
