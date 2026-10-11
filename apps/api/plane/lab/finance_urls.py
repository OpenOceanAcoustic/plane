# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from .finance_views import (
    FinanceActionView,
    FinancePermissionView,
    FinanceEntriesView,
    FinanceOverviewView,
    RewardForecastView,
    RewardFormulaView,
    RewardPreviewView,
)

finance_patterns = [
    path("finance/permissions/", FinancePermissionView.as_view()),
    path("finance/overview/", FinanceOverviewView.as_view()),
    path("finance/entries/", FinanceEntriesView.as_view()),
    path("finance/formulas/<uuid:pk>/", RewardFormulaView.as_view()),
    path("finance/preview/<uuid:pk>/", RewardPreviewView.as_view()),
    path("finance/forecast/", RewardForecastView.as_view()),
    path("finance/<str:action>/", FinanceActionView.as_view()),
]
