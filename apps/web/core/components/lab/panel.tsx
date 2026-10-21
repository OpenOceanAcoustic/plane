/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Link, useParams } from "react-router";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import { Button } from "@plane/ui";
import type { LabOpenProjectIssue } from "./item-details";
import { LabQuickActions } from "./quick-actions";
import { labSections } from "./sections";
// oxlint-disable-next-line import/no-unassigned-import -- scoped lab page accents
import "./theme.css";

const LabChat = lazy(() => import("./chat").then((module) => ({ default: module.LabChat })));
const LabCalendar = lazy(() => import("./calendar").then((module) => ({ default: module.LabCalendar })));
const LabFinance = lazy(() => import("./finance").then((module) => ({ default: module.LabFinance })));
const LabProjectQuality = lazy(() =>
  import("./project-quality").then((module) => ({ default: module.LabProjectQuality }))
);
const LabPlanningWorkbench = lazy(() =>
  import("./planner-workbench").then((module) => ({ default: module.LabPlanningWorkbench }))
);
const LabProjectPlanning = lazy(() =>
  import("./project-planning").then((module) => ({ default: module.LabProjectPlanning }))
);
const LabTaskTable = lazy(() => import("./task-table").then((module) => ({ default: module.LabTaskTable })));
const LabMarket = lazy(() => import("./market").then((module) => ({ default: module.LabMarket })));
const LabAnalyticsPanel = lazy(() => import("./analytics").then((module) => ({ default: module.LabAnalyticsPanel })));
const LabContributions = lazy(() => import("./contributions").then((module) => ({ default: module.LabContributions })));
const LabParticipation = lazy(() => import("./participation").then((module) => ({ default: module.LabParticipation })));

function SectionLoading({ label }: { label: string }) {
  return (
    <div className="lab-workbench-panel lab-section-loading" role="status" aria-live="polite">
      <span className="lab-section-loading-dot" aria-hidden="true" />
      <p className="text-13 text-secondary">正在加载{label}…</p>
    </div>
  );
}

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
    if (previousDetailsOpen.current && !projectDetailsOpen && section !== "chat") {
      if (section === "contributions") setRefreshKey((value) => value + 1);
      else void store.execute(store.loadPlanner);
    }
    previousDetailsOpen.current = projectDetailsOpen;
  }, [projectDetailsOpen, section, store]);
  useEffect(() => {
    if (section === "contributions" || section === "chat") return;
    if (!store.planner) void store.execute(store.loadPlanner);
    const refresh = () => {
      if (document.visibilityState === "visible") void store.execute(store.loadPlanner);
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [section, store]);
  if (section === "chat")
    return (
      <Suspense fallback={<SectionLoading label="聊天" />}>
        <LabChat openProjectIssue={openProjectIssue} />
      </Suspense>
    );
  const currentSection = labSections.find((entry) => entry.key === section) ?? labSections[0];
  const SectionIcon = currentSection.Icon;
  return (
    <main
      className="lab-page flex h-full w-full flex-col overflow-auto bg-surface-1 text-primary"
      data-lab-section={currentSection.key}
    >
      <header className="lab-page-header flex flex-wrap items-center gap-3 border-b border-subtle px-6 py-4">
        <h1 className="mr-auto flex items-center gap-3 text-18 font-semibold">
          <span className="lab-page-icon" aria-hidden="true">
            <SectionIcon size={19} />
          </span>
          {currentSection.name}
        </h1>
        <LabQuickActions workspaceSlug={workspaceSlug} />
        <Button
          size="sm"
          variant="neutral-primary"
          loading={store.busy}
          onClick={() =>
            section === "contributions"
              ? setRefreshKey((value) => value + 1)
              : void store.execute(async () => {
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
        {store.error && section !== "contributions" && (
          <p
            role="alert"
            className="rounded border border-danger-subtle bg-danger-subtle/10 p-3 text-13 text-danger-primary"
          >
            {store.error}
          </p>
        )}
        {store.notice && section !== "contributions" && (
          <p role="status" className="lab-page-notice rounded p-3 text-13">
            {store.notice}
          </p>
        )}
        {!store.planner && !store.error && section !== "contributions" && (
          <p className="text-13 text-tertiary">正在读取实验室规划…</p>
        )}
        <Suspense fallback={<SectionLoading label={currentSection.name} />}>
          {section === "contributions" && (
            <LabContributions store={store} refreshKey={refreshKey} openProjectIssue={openProjectIssue} />
          )}
          {store.planner && section === "planner" && (
            <LabPlanningWorkbench store={store} openProjectIssue={openProjectIssue} />
          )}
          {store.planner &&
            section === "team" &&
            ((store.planner.team_calendar_access ?? store.planner.team_access) ? (
              <LabCalendar
                key="team"
                store={store}
                team
                clearScheduled={() => undefined}
                openProjectIssue={openProjectIssue}
              />
            ) : (
              <div className="lab-empty-state">
                <p className="text-13 text-secondary">暂无团队排期查看权限</p>
                <p className="text-12 text-secondary">可以先用个人规划安排工作，或联系项目负责人开通团队排期。</p>
                <Link className="text-13 text-accent-primary" to={`/${workspaceSlug}/lab/planner`}>
                  去个人规划
                </Link>
              </div>
            ))}
          {store.planner && section === "planning" && (
            <LabProjectPlanning store={store} refreshKey={refreshKey} openProjectIssue={openProjectIssue} />
          )}
          {store.planner && section === "bounties" && <LabMarket store={store} />}
          {store.planner && section === "tasks" && <LabTaskTable store={store} refreshKey={refreshKey} />}
          {store.planner && section === "analytics" && <LabAnalyticsPanel store={store} refreshKey={refreshKey} />}
          {store.planner && section === "quality" && <LabProjectQuality store={store} refreshKey={refreshKey} />}
          {store.planner && section === "finance" && <LabFinance store={store} refreshKey={refreshKey} />}
          {store.planner && section === "participation" && <LabParticipation store={store} refreshKey={refreshKey} />}
        </Suspense>
      </div>
    </main>
  );
});
