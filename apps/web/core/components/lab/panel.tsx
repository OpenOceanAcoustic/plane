/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "react-router";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import { Button } from "@plane/ui";
import { LabCalendar } from "./calendar";
import { LabAnalyticsPanel } from "./analytics";
import { LabMarket } from "./market";
import { LabFinance } from "./finance";
import { LabPlanningWorkbench } from "./planner-workbench";
import { LabTaskTable } from "./task-table";
import type { LabOpenProjectIssue } from "./item-details";

export const LabPanel = observer(function LabPanel({
  openProjectIssue,
  projectDetailsOpen = false,
}: {
  openProjectIssue?: LabOpenProjectIssue;
  projectDetailsOpen?: boolean;
}) {
  const { workspaceSlug = "", section = "planner" } = useParams();
  const store = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const [refreshKey, setRefreshKey] = useState(0);
  const previousDetailsOpen = useRef(projectDetailsOpen);
  useEffect(() => {
    if (previousDetailsOpen.current && !projectDetailsOpen) void store.execute(store.loadPlanner);
    previousDetailsOpen.current = projectDetailsOpen;
  }, [projectDetailsOpen, store]);
  useEffect(() => {
    void store.execute(store.loadPlanner);
    const refresh = () => {
      if (document.visibilityState === "visible") void store.execute(store.loadPlanner);
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [store]);
  const title =
    (
      {
        planner: "个人规划",
        team: "团队排期",
        bounties: "悬赏大厅",
        tasks: "任务表格",
        analytics: "数据总览",
        finance: "资金与奖励",
      } as Record<string, string>
    )[section] ?? "个人规划";
  return (
    <main className="flex h-full w-full flex-col overflow-auto bg-surface-1 text-primary">
      <header className="flex flex-wrap items-center gap-3 border-b border-subtle px-6 py-4">
        <h1 className="mr-auto text-18 font-semibold">{title}</h1>
        <Button
          size="sm"
          variant="neutral-primary"
          loading={store.busy}
          onClick={() =>
            void store.execute(async () => {
              await store.loadPlanner();
              if (section === "bounties") await store.loadMarket();
              setRefreshKey((value) => value + 1);
            })
          }
        >
          刷新
        </Button>
      </header>
      <div className="flex flex-col gap-5 p-6">
        {store.error && (
          <p
            role="alert"
            className="rounded border border-danger-subtle bg-danger-subtle/10 p-3 text-13 text-danger-primary"
          >
            {store.error}
          </p>
        )}
        {store.notice && (
          <p role="status" className="rounded bg-layer-1 p-3 text-13">
            {store.notice}
          </p>
        )}
        {!store.planner && !store.error && <p className="text-13 text-tertiary">正在读取实验室规划…</p>}
        {store.planner && section === "planner" && (
          <LabPlanningWorkbench store={store} openProjectIssue={openProjectIssue} />
        )}
        {store.planner &&
          section === "team" &&
          (store.planner.team_access ? (
            <LabCalendar
              key="team"
              store={store}
              team
              clearScheduled={() => undefined}
              openProjectIssue={openProjectIssue}
            />
          ) : (
            <p className="text-13 text-secondary">
              仅工作区管理员和项目负责人可以查看团队排期。请在个人周历维护本人安排。
            </p>
          ))}
        {store.planner && section === "bounties" && <LabMarket store={store} />}
        {store.planner && section === "tasks" && <LabTaskTable store={store} refreshKey={refreshKey} />}
        {store.planner && section === "analytics" && <LabAnalyticsPanel store={store} refreshKey={refreshKey} />}
        {store.planner && section === "finance" && <LabFinance store={store} refreshKey={refreshKey} />}
      </div>
    </main>
  );
});
