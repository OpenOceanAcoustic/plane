/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useState } from "react";
import type { LabFinanceManagement } from "@plane/types";
import { LabStore } from "../../../packages/shared-state/src/lab.store";
import { FinanceManagementDialog } from "../../../apps/web/core/components/lab/finance-management-form";
import { MonthlyPayrollSchedule } from "../../../apps/web/core/components/lab/finance-monthly-payroll";

export function FinanceMonthlyHarness() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  const [data, setData] = useState<LabFinanceManagement>();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(0);
  const query = new URLSearchParams(window.location.search);
  const path = "projects/project-a/finance-management/";
  useEffect(() => {
    void store.request<LabFinanceManagement>(path).then(setData);
  }, [store]);
  if (!data) return null;
  return (
    <>
      <button onClick={() => setOpen(true)}>生成工资单</button>
      <output>刷新次数：{saved}</output>
      <MonthlyPayrollSchedule store={store} projectId="project-a" />
      {open && (
        <FinanceManagementDialog
          store={store}
          path={path}
          data={data}
          chosen={{
            kind: "payroll",
            action: "save",
            ...(query.has("ai") ? { prefill: { user_id: "member-a", start: "2026-09-03", end: "2026-09-18" } } : {}),
          }}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setSaved((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
