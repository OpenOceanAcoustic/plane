/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import {
  MessageSquare,
  BarChart3,
  CalendarDays,
  CalendarRange,
  Coins,
  FolderKanban,
  TableProperties,
  Target,
  Banknote,
  Wallet,
  ClipboardCheck,
  Handshake,
} from "lucide-react";

export const labSections = [
  { key: "chat", name: "聊天", Icon: MessageSquare },
  { key: "planner", name: "个人规划", Icon: FolderKanban },
  { key: "contributions", name: "我的项目与贡献", Icon: Coins },
  { key: "team", name: "团队排期", Icon: CalendarDays },
  { key: "planning", name: "项目规划", Icon: CalendarRange },
  { key: "tasks", name: "任务表格", Icon: TableProperties },
  { key: "bounties", name: "悬赏大厅", Icon: Target },
  { key: "cash", name: "现金悬赏", Icon: Banknote },
  { key: "finance", name: "资金与奖励", Icon: Wallet },
  { key: "quality", name: "项目与质量", Icon: ClipboardCheck },
  { key: "participation", name: "参与管理", Icon: Handshake },
  { key: "analytics", name: "数据总览", Icon: BarChart3 },
] as const;
