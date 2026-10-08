/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { observer } from "mobx-react";
import { LabAuth } from "../../../packages/ui/src/lab-auth";
import { LabStore } from "../../../packages/shared-state/src/lab.store";
import { LabPlannerBoard } from "../../../apps/web/core/components/lab/planner";
import { LabCalendar } from "../../../apps/web/core/components/lab/calendar";
import { LabPlanningWorkbench } from "../../../apps/web/core/components/lab/planner-workbench";
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
      <LabPlannerBoard store={store} schedule={setScheduled} />
      <LabCalendar store={store} scheduled={scheduled} clearScheduled={() => setScheduled(undefined)} />
    </>
  );
});
const path = window.location.pathname;
const Workbench = observer(function Workbench() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  useEffect(() => {
    void store.execute(store.loadPlanner);
  }, [store]);
  return (
    <main>
      {store.error && <p role="alert">{store.error}</p>}
      <LabPlanningWorkbench store={store} />
    </main>
  );
});
function Analytics() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  return <LabAnalyticsPanel store={store} />;
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {path === "/analytics" ? (
      <Analytics />
    ) : path === "/planner" ? (
      <Planning />
    ) : path === "/workbench" ? (
      <Workbench />
    ) : (
      <LabAuth
        register={path === "/register"}
        admin={path === "/admin"}
        onSuccess={() => window.location.assign("/planner")}
      />
    )}
  </StrictMode>
);
