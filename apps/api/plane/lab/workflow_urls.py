# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from .workflow import BountyWorkflowView

workflow_patterns = [path("bounties/<uuid:pk>/workflow/", BountyWorkflowView.as_view())]
