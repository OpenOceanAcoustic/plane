/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BarChart3, CalendarDays, FolderKanban, TableProperties, Target } from "lucide-react";
import { Link, useParams, useLocation } from "react-router";
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";

export function LabNavigation() {
  const { workspaceSlug } = useParams();
  const { pathname } = useLocation();
  if (!workspaceSlug) return null;
  return (
    <div className="mt-2 flex flex-col gap-0.5 border-t border-subtle pt-2">
      {[
        { key: "planner", name: "个人规划", Icon: FolderKanban },
        { key: "team", name: "团队排期", Icon: CalendarDays },
        { key: "tasks", name: "任务表格", Icon: TableProperties },
        { key: "bounties", name: "悬赏大厅", Icon: Target },
        { key: "analytics", name: "数据总览", Icon: BarChart3 },
      ].map(({ key, name, Icon }) => {
        const href = `/${workspaceSlug}/lab/${key}`;
        return (
          <Link key={key} to={href}>
            <SidebarNavItem isActive={pathname === href}>
              <div className="flex items-center gap-1.5 py-[1px] text-13 font-medium">
                <Icon className="size-4" />
                <span>{name}</span>
              </div>
            </SidebarNavItem>
          </Link>
        );
      })}
      <a
        href="https://github.com/OpenOceanAcoustic/plane/tree/feat/lab-planning-bounty-auth"
        target="_blank"
        rel="noreferrer"
        className="mt-2 px-3 text-12 text-tertiary hover:text-secondary"
      >
        源代码与许可证
      </a>
    </div>
  );
}
