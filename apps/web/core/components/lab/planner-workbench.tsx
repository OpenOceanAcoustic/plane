/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from "react";
import { observer } from "mobx-react";
import { CalendarCheck2, Clock3, ListTodo, LayoutPanelLeft, Columns3, CalendarDays, ArrowUpRight } from "lucide-react";
import type { LabItem } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button } from "@plane/ui";
import { LabCalendar } from "./calendar";
import { LabPlannerBoard } from "./planner";
// oxlint-disable-next-line import/no-unassigned-import -- responsive workbench layout
import "./planner-workbench.css";

export const LabPlanningWorkbench = observer(function LabPlanningWorkbench({ store }: { store: LabStore }) {
  const [mode, setMode] = useState<"combined" | "board" | "calendar">("combined");
  const [scheduled, setScheduled] = useState<LabItem>();
  const planner = store.planner;
  if (!planner) return null;
  const pending = planner.items.filter((item) => item.status !== "done" && item.schedule?.future_count === 0).length;
  const weeklyMinutes = planner.items.reduce((sum, item) => sum + (item.schedule?.week_minutes ?? 0), 0);
  const hours = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(weeklyMinutes / 60);
  return (
    <div className="lab-planning-workbench flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="规划布局"
          className="flex flex-wrap items-center gap-1 rounded-lg border border-subtle bg-layer-1 p-1"
        >
          {[
            { key: "combined", label: "综合", Icon: LayoutPanelLeft },
            { key: "board", label: "文件夹看板", Icon: Columns3 },
            { key: "calendar", label: "个人周历", Icon: CalendarDays },
          ].map(({ key, label, Icon }) => (
            <Button
              key={key}
              size="sm"
              variant={mode === key ? "primary" : "neutral-primary"}
              aria-pressed={mode === key}
              onClick={() => setMode(key as typeof mode)}
            >
              <Icon size={14} /> {label}
            </Button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {planner.team_access && (
            <a href={`/${store.slug}/lab/team`} className="flex items-center gap-1 text-13 text-accent-primary">
              查看团队排期 <ArrowUpRight size={14} />
            </a>
          )}
          <details className="relative text-12 text-secondary">
            <summary className="cursor-pointer rounded-md border border-subtle px-3 py-2">导出全部规划</summary>
            <div className="absolute right-0 z-40 mt-1 flex min-w-36 flex-col gap-1 rounded-lg border border-subtle bg-surface-1 p-2">
              <a
                className="rounded px-2 py-2 hover:bg-layer-1"
                href={`${store.apiBase}/api/workspaces/${encodeURIComponent(store.slug)}/lab/planning-export/?format=csv`}
              >
                导出排期 CSV
              </a>
              <a
                className="rounded px-2 py-2 hover:bg-layer-1"
                href={`${store.apiBase}/api/workspaces/${encodeURIComponent(store.slug)}/lab/planning-export/`}
                target="_blank"
                rel="noreferrer"
              >
                JSON
              </a>
            </div>
          </details>
        </div>
      </div>
      <div className="lab-planning-summary rounded-xl border border-subtle bg-layer-1">
        <div>
          <ListTodo size={16} />
          <span>规划事项</span>
          <strong>{planner.items.length}</strong>
        </div>
        <div>
          <Clock3 size={16} />
          <span>待排事项</span>
          <strong>{pending}</strong>
        </div>
        <div>
          <CalendarCheck2 size={16} />
          <span>本周计划</span>
          <strong>
            {hours}
            <span className="font-normal ml-1 text-12 text-secondary">小时</span>
          </strong>
        </div>
      </div>
      <div className="lab-planning-layout" data-layout={mode}>
        <section className="lab-planning-pane" hidden={mode === "calendar"} aria-label="文件夹看板区域">
          <LabPlannerBoard
            store={store}
            compact={mode === "combined"}
            schedule={(item) => {
              setScheduled(item);
              if (mode === "board") setMode("combined");
            }}
          />
        </section>
        <section className="lab-planning-pane" hidden={mode === "board"} aria-label="个人周历区域">
          <LabCalendar
            store={store}
            scheduled={scheduled}
            clearScheduled={() => setScheduled(undefined)}
            onCalendarChanged={store.loadPlanner}
          />
        </section>
      </div>
    </div>
  );
});
