/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CalendarDays, FolderKanban, Target } from "lucide-react";
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
        { key: "bounties", name: "悬赏大厅", Icon: Target },
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
    </div>
  );
}
