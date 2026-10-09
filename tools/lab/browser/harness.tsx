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
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Toast theme="light" />
    {path === "/analytics" ? (
      <Analytics />
    ) : path === "/planner" ? (
      <Planning />
    ) : path === "/workbench" ? (
      <Workbench />
    ) : path === "/team" ? (
      <Workbench section="team" />
    ) : (
      <LabAuth
        register={path === "/register"}
        admin={path === "/admin"}
        onSuccess={() => window.location.assign("/planner")}
      />
    )}
  </StrictMode>
);
