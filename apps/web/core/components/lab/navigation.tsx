/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Link, useParams, useLocation } from "react-router";
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
import { labSections } from "./sections";
// oxlint-disable-next-line import/no-unassigned-import -- scoped lab navigation colors
import "./theme.css";

export function LabNavigation() {
  const { workspaceSlug } = useParams();
  const { pathname } = useLocation();
  if (!workspaceSlug) return null;
  return (
    <div className="mt-2 flex flex-col gap-0.5 border-t border-subtle pt-2">
      {labSections.map(({ key, name, Icon }) => {
        const href = `/${workspaceSlug}/lab/${key}`;
        return (
          <Link
            key={key}
            to={href}
            className="lab-navigation-item"
            data-lab-section={key}
            aria-current={pathname === href ? "page" : undefined}
          >
            <SidebarNavItem isActive={pathname === href}>
              <div className="flex items-center gap-1.5 py-[1px] text-13 font-medium">
                <Icon className="lab-navigation-icon size-4" />
                <span>{name}</span>
              </div>
            </SidebarNavItem>
          </Link>
        );
      })}
      <a
        href="https://github.com/OpenOceanAcoustic/plane/tree/feat/project-document-files"
        target="_blank"
        rel="noreferrer"
        className="mt-2 px-3 text-12 text-tertiary hover:text-secondary"
      >
        源代码与许可证
      </a>
    </div>
  );
}
