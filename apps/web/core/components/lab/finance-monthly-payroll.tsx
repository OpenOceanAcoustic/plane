/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { LabStore } from "@plane/shared-state";
import type { LabMonthlyPayrollOverview, LabMonthlyPayrollProject, LabMonthlyPayrollResult } from "@plane/types";
import { Button, LabDialog, LabField, labDecimalText, labDecimalUnits, labInputClass } from "@plane/ui";

const endpoint = "payroll-monthly/";
const runLabels = { success: "已完成", partial: "部分完成", failed: "生成失败" };
const timestamp = (value: string | null, timezone: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "—";

function useMonthlyPayroll(store: LabStore, month = "") {
  return useSWR(
    ["lab-monthly-payroll", store.slug, month],
    () => store.request<LabMonthlyPayrollOverview>(`${endpoint}${month ? `?month=${encodeURIComponent(month)}` : ""}`),
    { shouldRetryOnError: false }
  );
}

function PayrollSchedule({
  store,
  data,
  projects,
  disabled = false,
}: {
  store: LabStore;
  data: LabMonthlyPayrollOverview;
  projects: LabMonthlyPayrollProject[];
  disabled?: boolean;
}) {
  const { mutate: refreshSchedules } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabled = projects.filter((project) => project.schedule.enabled).length;
  const canManage = projects.length > 0 && projects.every((project) => project.can_manage_schedule);
  const setEnabled = async (value: boolean) => {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      await store.request(endpoint, "PATCH", {
        project_ids: projects.map((project) => project.project_id),
        enabled: value,
      });
      await refreshSchedules((key) => Array.isArray(key) && key[0] === "lab-monthly-payroll" && key[1] === store.slug);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "设置失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3" aria-label="月末自动生成">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-14 font-medium">月末自动生成工资单</h3>
        <span className="text-13">
          {enabled === 0 ? "未启用" : enabled === projects.length ? "已启用" : `${enabled} 个项目已启用`}
        </span>
      </div>
      <dl className="space-y-1 text-13">
        <div>生成时间：每月最后一天 {data.time}</div>
        <div>时区：{data.timezone}</div>
        <div>生成结果：待付款工资单</div>
      </dl>
      {projects.map((project) => (
        <div key={project.project_id} className="space-y-1 text-13">
          {projects.length > 1 && <p className="font-medium">{project.project_name}</p>}
          <p>下次执行：{timestamp(project.schedule.next_run_at, data.timezone)}</p>
          <p>
            最近执行：{timestamp(project.schedule.last_run_at, data.timezone)}
            {project.schedule.last_status ? ` · ${runLabels[project.schedule.last_status]}` : ""}
          </p>
          {project.schedule.last_month && <p>最近工资月份：{project.schedule.last_month}</p>}
          {project.schedule.last_error && <p className="text-danger-primary">{project.schedule.last_error}</p>}
        </div>
      ))}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {enabled < projects.length && projects.every((project) => project.can_generate) && (
            <Button
              size="sm"
              variant="neutral-primary"
              disabled={busy || disabled}
              onClick={() => void setEnabled(true)}
            >
              启用月末自动生成
            </Button>
          )}
          {enabled > 0 && (
            <Button
              size="sm"
              variant="neutral-primary"
              disabled={busy || disabled}
              onClick={() => void setEnabled(false)}
            >
              停用月末自动生成
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger-primary">
          {error}
        </p>
      )}
    </section>
  );
}

export function MonthlyPayrollSchedule({ store, projectId }: { store: LabStore; projectId: string }) {
  const { data, error } = useMonthlyPayroll(store);
  const project = data?.projects.find((entry) => entry.project_id === projectId);
  if (error) return <p role="alert">{error instanceof Error ? error.message : "月度工资计划读取失败"}</p>;
  if (!data || !project) return null;
  return (
    <div className="rounded-lg border border-subtle bg-layer-1 p-4">
      <PayrollSchedule store={store} data={data} projects={[project]} />
    </div>
  );
}

export function MonthlyPayrollDialog({
  store,
  projectId,
  onClose,
  onSaved,
  onIndividual,
}: {
  store: LabStore;
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onIndividual: () => void;
}) {
  const [month, setMonth] = useState("");
  const [scope, setScope] = useState("project");
  const { data, error, mutate } = useMonthlyPayroll(store, month);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [result, setResult] = useState<LabMonthlyPayrollResult>();
  const selectedMonth = month || data?.current_month || "";
  const projects =
    data?.projects.filter((project) => project.can_generate && (scope === "all" || project.project_id === projectId)) ??
    [];
  const costCount = projects.reduce((sum, project) => sum + project.eligible_count, 0);
  const total = labDecimalText(
    projects.reduce((sum, project) => sum + (labDecimalUnits(project.eligible_amount) ?? 0n), 0n)
  );
  return (
    <LabDialog
      title="按月生成工资单"
      submitLabel="生成工资单"
      busy={busy}
      submitDisabled={!data || !selectedMonth || !projects.length || Boolean(error)}
      error={failure || (error instanceof Error ? error.message : error ? "月度工资读取失败" : "")}
      onClose={onClose}
      onSubmit={async () => {
        if (!data || busy) return;
        setBusy(true);
        setFailure("");
        setResult(undefined);
        try {
          const response = await store.request<LabMonthlyPayrollResult>(endpoint, "POST", {
            month: selectedMonth,
            project_ids: projects.map((project) => project.project_id),
          });
          setResult(response);
          await Promise.all([mutate(), onSaved()]);
        } catch (problem) {
          setFailure(problem instanceof Error ? problem.message : "生成失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        <LabField label="工资月份">
          <input
            aria-label="工资月份"
            name="month"
            type="month"
            required
            className={labInputClass}
            value={selectedMonth}
            onChange={(event) => {
              setMonth(event.target.value);
              setResult(undefined);
            }}
          />
        </LabField>
        <LabField label="生成范围">
          <select
            aria-label="生成范围"
            className={labInputClass}
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setResult(undefined);
            }}
          >
            <option value="project">当前项目</option>
            <option value="all">所有有权项目</option>
          </select>
        </LabField>
        {data && (
          <dl className="space-y-1 rounded-lg border border-subtle bg-layer-2 p-3 text-13">
            <div>
              计薪期间：{data.start} 至 {data.end}
            </div>
            <div>计薪人员：各项目全部符合条件的成员</div>
            <div>
              待计薪工时：{costCount} 条 · {projects.length} 个项目
            </div>
            <div>待生成金额：¥{total}</div>
            <div>工资单状态：待付款</div>
          </dl>
        )}
        {data && !projects.length && <p>没有可生成工资单的项目</p>}
        <Button size="sm" variant="neutral-primary" onClick={onIndividual}>
          指定成员与日期
        </Button>
      </fieldset>
      {result && (
        <div role="status" className="space-y-1 rounded-lg border border-subtle p-3 text-13">
          <p>
            {result.month}：已生成 {result.created_count} 张工资单，合计 ¥{result.created_amount}
          </p>
          {result.projects.map((project) => (
            <p key={project.project_id}>
              {data?.projects.find((entry) => entry.project_id === project.project_id)?.project_name ?? "项目"}：
              {runLabels[project.status]} · {project.created_count} 张{project.error ? ` · ${project.error}` : ""}
            </p>
          ))}
        </div>
      )}
      {data && projects.length > 0 && <PayrollSchedule store={store} data={data} projects={projects} disabled={busy} />}
    </LabDialog>
  );
}
