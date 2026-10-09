/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { BarChart3, CalendarDays, FolderKanban, TableProperties, Target, Wallet } from "lucide-react";

export const labSections = [
  { key: "planner", name: "个人规划", Icon: FolderKanban },
  { key: "team", name: "团队排期", Icon: CalendarDays },
  { key: "tasks", name: "任务表格", Icon: TableProperties },
  { key: "bounties", name: "悬赏大厅", Icon: Target },
  { key: "finance", name: "资金与奖励", Icon: Wallet },
  { key: "analytics", name: "数据总览", Icon: BarChart3 },
] as const;
