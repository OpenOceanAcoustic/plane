/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { observer } from "mobx-react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Toast } from "@plane/propel/toast";
import { LabAuth } from "../../../packages/ui/src/lab-auth";
import { LabStore } from "../../../packages/shared-state/src/lab.store";
import { LabPlannerBoard } from "../../../apps/web/core/components/lab/planner";
import { LabCalendar } from "../../../apps/web/core/components/lab/calendar";
import { LabCategoryManager } from "../../../apps/web/core/components/lab/categories";
import { LabPanel } from "../../../apps/web/core/components/lab/panel";
import { LabAnalyticsPanel } from "../../../apps/web/core/components/lab/analytics";
import { LabContributions } from "../../../apps/web/core/components/lab/contributions";
import { FinancePermissionDialog as WebFinancePermissionDialog } from "../../../apps/web/core/components/lab/finance-permissions";
import { FinancePermissionDialog as MobileFinancePermissionDialog } from "../../../apps/mobile/src/features/lab/finance-permissions";
import type { LabStore as MobileLabStore } from "../../../apps/mobile/src/features/lab/transport";
import type { LabItem } from "@plane/types";

const Planning = observer(function Planning() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  const [scheduled, setScheduled] = useState<LabItem>();
  useEffect(() => {
    void store.execute(store.loadPlanner);
  }, [store]);
  return (
    <>
      {store.error && <p role="alert">{store.error}</p>}
      {store.notice && <p role="status">{store.notice}</p>}
      <LabCategoryManager store={store} />
      <LabPlannerBoard store={store} schedule={setScheduled} />
      <LabCalendar store={store} scheduled={scheduled} clearScheduled={() => setScheduled(undefined)} />
    </>
  );
});
function FinancePermissions({ mobile = false }: { mobile?: boolean }) {
  const store = useMemo(() => new LabStore("", "lab"), []);
  const [closed, setClosed] = useState(false);
  const mobileStore: MobileLabStore = {
    slug: "lab",
    scope: "lab",
    stages: [],
    bounties: [],
    busy: false,
    error: "",
    request: store.request,
    execute: store.execute,
    loadPlanner: store.loadPlanner,
    loadMarket: store.loadMarket,
  };
  if (closed) return <p>授权已保存</p>;
  const onSaved = async () => {
    await store.request("finance/overview/");
  };
  return mobile ? (
    <MobileFinancePermissionDialog
      store={mobileStore}
      projectId="project-1"
      onClose={() => setClosed(true)}
      onSaved={onSaved}
    />
  ) : (
    <WebFinancePermissionDialog store={store} projectId="project-1" onClose={() => setClosed(true)} onSaved={onSaved} />
  );
}
const path = window.location.pathname;
function Workbench({ section = "planner" }: { section?: "planner" | "team" }) {
  return (
    <div style={{ height: "calc(100dvh - 48px)" }}>
      <MemoryRouter initialEntries={[`/lab/lab/${section}`]}>
        <Routes>
          <Route
            path="/:workspaceSlug/lab/:section"
            element={
              <LabPanel
                openProjectIssue={(issue) =>
                  window.dispatchEvent(new CustomEvent("lab-open-project-issue", { detail: issue }))
                }
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </div>
  );
}
function Analytics() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  return <LabAnalyticsPanel store={store} />;
}
function Contributions() {
  const [workspace, setWorkspace] = useState("lab");
  const store = useMemo(() => new LabStore("", workspace), [workspace]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const switchWorkspace = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string") setWorkspace(event.detail);
    };
    window.addEventListener("lab-refresh-contributions", refresh);
    window.addEventListener("lab-switch-contributions-workspace", switchWorkspace);
    return () => {
      window.removeEventListener("lab-refresh-contributions", refresh);
      window.removeEventListener("lab-switch-contributions-workspace", switchWorkspace);
    };
  }, []);
  return (
    <MemoryRouter>
      <h1>我的项目与 VC</h1>
      <LabContributions
        store={store}
        refreshKey={revision}
        openProjectIssue={(issue) => window.dispatchEvent(new CustomEvent("lab-open-project-issue", { detail: issue }))}
      />
    </MemoryRouter>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Toast theme="light" />
    {path === "/finance-permissions" || path === "/mobile-finance-permissions" ? (
      <FinancePermissions mobile={path.startsWith("/mobile")} />
    ) : path === "/contributions" ? (
      <Contributions />
    ) : path === "/analytics" ? (
      <Analytics />
    ) : path === "/planner" ? (
      <Planning />
    ) : path === "/workbench" ? (
      <Workbench />
    ) : path === "/team" ? (
      <Workbench section="team" />
    ) : (
      <LabAuth
        register={path === "/register" || path.startsWith("/register/")}
        invitationToken={/^\/register\/([A-Za-z0-9_-]{43})$/.exec(path)?.[1]}
        admin={path === "/admin"}
        onSuccess={() => window.location.replace(path.startsWith("/register/") ? "/" : "/planner")}
      />
    )}
  </StrictMode>
);
