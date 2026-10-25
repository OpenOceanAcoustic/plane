/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { observer } from "mobx-react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Toast } from "@plane/propel/toast";
import { LabAuth } from "../../../packages/ui/src/lab-auth";
import { LabStore } from "../../../packages/shared-state/src/lab.store";
import { LabPlannerBoard } from "../../../apps/web/core/components/lab/planner";
import { LabAgentChat } from "../../../apps/web/core/components/lab/agent-chat";
import { LabCalendar } from "../../../apps/web/core/components/lab/calendar";
import { LabCategoryManager } from "../../../apps/web/core/components/lab/categories";
import { LabPanel } from "../../../apps/web/core/components/lab/panel";
import { LabAnalyticsPanel } from "../../../apps/web/core/components/lab/analytics";
import { LabContributions } from "../../../apps/web/core/components/lab/contributions";
import { FinancePermissionDialog as WebFinancePermissionDialog } from "../../../apps/web/core/components/lab/finance-permissions";
import { FinancePermissionDialog as MobileFinancePermissionDialog } from "../../../apps/mobile/src/features/lab/finance-permissions";
import type { LabStore as MobileLabStore } from "../../../apps/mobile/src/features/lab/transport";
import type { LabItem, LabFinanceOverview } from "@plane/types";
import { LabFinanceActionDialog } from "../../../apps/web/core/components/lab/finance-form";
import { Planner as MobilePlanner } from "../../../apps/mobile/src/features/lab/planner";
import { LabPlanningVisibilityFields } from "../../../packages/ui/src/lab-planning-visibility";
import { MobileSelect } from "../../../apps/mobile/src/components/select";

function VisibilityFields({ mobile = false }: { mobile?: boolean }) {
  const [saved, setSaved] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSaved(
          JSON.stringify({ visibility: data.get("visibility"), shared_user_ids: data.getAll("shared_user_ids") })
        );
      }}
    >
      <LabPlanningVisibilityFields
        members={[
          { id: "member-2", name: "张三" },
          { id: "member-3", name: "李四" },
        ]}
        SelectComponent={mobile ? MobileSelect : "select"}
      />
      <button type="submit">保存</button>
      <output>{saved}</output>
    </form>
  );
}
const MobilePlanning = observer(function MobilePlanning() {
  const source = useMemo(() => new LabStore("", "lab"), []);
  useEffect(() => {
    void source.execute(source.loadPlanner);
  }, [source]);
  const store: MobileLabStore = {
    slug: "lab",
    scope: "lab",
    planner: source.planner,
    stages: [],
    bounties: [],
    busy: source.busy,
    error: source.error,
    request: source.request,
    execute: source.execute,
    loadPlanner: source.loadPlanner,
    loadMarket: source.loadMarket,
  };
  return <MobilePlanner store={store} onOpenBounty={() => {}} />;
});

const Planning = observer(function Planning() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  const [scheduled, setScheduled] = useState<LabItem>();
  useEffect(() => {
    void store.execute(store.loadPlanner);
  }, [store]);
  return (
    <MemoryRouter>
      {store.error && <p role="alert">{store.error}</p>}
      {store.notice && <p role="status">{store.notice}</p>}
      <LabCategoryManager store={store} />
      <LabPlannerBoard store={store} schedule={setScheduled} />
      <LabCalendar store={store} scheduled={scheduled} clearScheduled={() => setScheduled(undefined)} />
    </MemoryRouter>
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
const ReceiptForm = observer(function ReceiptForm() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  const [data, setData] = useState<LabFinanceOverview>();
  const [closed, setClosed] = useState(false);
  const reload = useCallback(async () => {
    await Promise.all([store.loadMarket(), store.request<LabFinanceOverview>("finance/overview/").then(setData)]);
  }, [store]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (closed) return <p>入账已保存</p>;
  if (!data) return null;
  return (
    <LabFinanceActionDialog
      store={store}
      data={data}
      projectId={new URLSearchParams(window.location.search).get("scope") === "all" ? "" : "project-a"}
      chosen={
        new URLSearchParams(window.location.search).get("form") === "allocation"
          ? { action: "stage-allocation", body: { from_account_id: "project-cash" } }
          : { action: "receipt", body: { gross: "1000.00", source: "自筹资金", stage_id: "stale-ai-stage" } }
      }
      onClose={() => setClosed(true)}
      onSaved={reload}
    />
  );
});
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
function AgentChat() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  return (
    <MemoryRouter>
      <LabAgentChat store={store} workspaceSlug="lab" fullPage />
    </MemoryRouter>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Toast theme="light" />
    {path === "/receipt-form" ? (
      <ReceiptForm />
    ) : path === "/agent-chat" ? (
      <AgentChat />
    ) : path === "/finance-permissions" || path === "/mobile-finance-permissions" ? (
      <FinancePermissions mobile={path.startsWith("/mobile")} />
    ) : path === "/contributions" ? (
      <Contributions />
    ) : path === "/analytics" ? (
      <Analytics />
    ) : path === "/visibility-fields" || path === "/mobile-visibility-fields" ? (
      <VisibilityFields mobile={path.startsWith("/mobile")} />
    ) : path === "/mobile-planner" ? (
      <MobilePlanning />
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
