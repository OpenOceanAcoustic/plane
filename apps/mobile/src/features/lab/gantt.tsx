/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { MobileSelect } from "../../components/select";
import { useState } from "react";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { LabDialog, LabField, Button, ErrorMessage, Empty, KeyValues } from "./ui";
type Task = {
  id: string;
  key: string;
  title: string;
  start_date: string | null;
  target_date: string | null;
  state_group: string;
};
type Dependency = { id: string; predecessor_id: string; successor_id: string };
type Data = { tasks: Task[]; dependencies: Dependency[]; can_manage?: boolean };
type Change = Task & { old_start_date: string | null; old_target_date: string | null };
export function Gantt({
  store,
  projectId,
  onOpenIssue,
}: {
  store: LabStore;
  projectId: string;
  onOpenIssue?: (project: string, issue: string) => void;
}) {
  const base = `projects/${projectId}/gantt/`;
  const data = useResource<Data>(store, base);
  const [editing, setEditing] = useState<Task>();
  const [preview, setPreview] = useState<{ token: string; changes: Change[] }>();
  const [dependency, setDependency] = useState(false);
  const [error, setError] = useState("");
  const lead = !!store.planner?.projects.find((row) => row.id === projectId)?.lead;
  const dates = (data.data?.tasks ?? [])
    .flatMap((row) => [row.start_date, row.target_date].filter(Boolean) as string[])
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sorts a new local list
    .sort();
  const from = dates.length ? new Date(dates[0]!).getTime() : Date.now(),
    to = dates.length ? new Date(dates.at(-1)!).getTime() + 86400000 : from + 86400000;
  const days = Math.max(1, Math.ceil((to - from) / 86400000));
  const tickCount = Math.min(7, days);
  const ticks = Array.from({ length: tickCount }, (_, index) =>
    new Date(from + Math.floor((index * (days - 1)) / Math.max(1, tickCount - 1)) * 86400000).toISOString().slice(0, 10)
  );
  return (
    <>
      <div className="lab-section-heading">
        <h3>项目甘特排期</h3>
        <Button onClick={() => setDependency(true)}>任务依赖</Button>
      </div>
      <ErrorMessage error={data.error || error} />
      {dates.length > 0 && (
        <div className="lab-range-timeline">
          <div className="lab-range-labels">
            <span>任务</span>
            <div style={{ gridTemplateColumns: `repeat(${ticks.length}, 1fr)` }}>
              {ticks.map((date) => (
                <span key={date}>{date.slice(5)}</span>
              ))}
            </div>
          </div>
          {data.data?.tasks
            .filter((row) => row.start_date && row.target_date)
            .map((row) => (
              <div className="lab-range-row" key={row.id}>
                <span title={`${row.key} · ${row.title}`}>{row.key}</span>
                <div className="lab-range-track">
                  <button
                    className="lab-range-event"
                    disabled={!lead && !onOpenIssue}
                    style={{
                      left: `${(100 * (new Date(row.start_date!).getTime() - from)) / (to - from)}%`,
                      width: `${Math.max(2, (100 * (new Date(row.target_date!).getTime() + 86400000 - new Date(row.start_date!).getTime())) / (to - from))}%`,
                    }}
                    onClick={() => (lead ? setEditing(row) : onOpenIssue?.(projectId, row.id))}
                  >
                    {row.title}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
      <h3 className="lab-section-heading">任务排期记录</h3>
      {data.data?.tasks.map((row) => (
        <article key={row.id} className="lab-card">
          <h3>
            {row.key} · {row.title}
          </h3>
          <KeyValues values={{ 开始: row.start_date, 截止: row.target_date }} />
          <div className="lab-actions">
            {onOpenIssue && <Button onClick={() => onOpenIssue(projectId, row.id)}>任务详情</Button>}
            {lead && <Button onClick={() => setEditing(row)}>调整日期</Button>}
          </div>
        </article>
      ))}
      {data.data && !data.data.tasks.length && <Empty />}
      {editing && (
        <LabDialog
          title="预览日期联动"
          onClose={() => setEditing(undefined)}
          onSubmit={async (form) => {
            setError("");
            const result = await store.request<{ token: string; changes: Change[] }>(base + "preview/", "POST", {
              issue_id: editing.id,
              start_date: form.get("start_date"),
              target_date: form.get("target_date"),
            });
            setPreview(result);
            setEditing(undefined);
          }}
        >
          <LabField label="开始日期">
            <input name="start_date" required type="date" defaultValue={editing.start_date ?? ""} />
          </LabField>
          <LabField label="截止日期">
            <input name="target_date" required type="date" defaultValue={editing.target_date ?? ""} />
          </LabField>
        </LabDialog>
      )}
      {preview && (
        <LabDialog
          title="确认日期联动"
          onClose={() => setPreview(undefined)}
          onSubmit={async () => {
            await store.request(base + "commit/", "POST", { token: preview.token });
            await data.refresh();
            await store.loadPlanner();
            setPreview(undefined);
          }}
        >
          <p>将更新 {preview.changes.length} 项任务，只有确认后才提交。</p>
          {preview.changes.map((row) => (
            <article key={row.id} className="lab-card">
              <h3>
                {row.key} {row.title}
              </h3>
              <KeyValues
                values={{
                  原排期: `${row.old_start_date ?? "未排期"} ～ ${row.old_target_date ?? "未排期"}`,
                  新排期: `${row.start_date} ～ ${row.target_date}`,
                }}
              />
            </article>
          ))}
        </LabDialog>
      )}
      {dependency && (
        <LabDialog
          title="任务依赖"
          onClose={() => setDependency(false)}
          {...(lead
            ? {
                onSubmit: async (form: FormData) => {
                  await store.request(base + "dependencies/", "POST", {
                    predecessor_id: form.get("predecessor"),
                    successor_id: form.get("successor"),
                  });
                  await data.refresh();
                },
                submitLabel: "添加依赖",
              }
            : {})}
        >
          {data.data?.dependencies.map((edge) => (
            <div key={edge.id} className="lab-card">
              <p>
                {data.data?.tasks.find((row) => row.id === edge.predecessor_id)?.title} →{" "}
                {data.data?.tasks.find((row) => row.id === edge.successor_id)?.title}
              </p>
              {lead && (
                <Button
                  onClick={() =>
                    void store
                      .execute(async () => {
                        await store.request(base + "dependencies/", "DELETE", { id: edge.id });
                        await data.refresh();
                      })
                      .catch(() => {})
                  }
                >
                  解除依赖
                </Button>
              )}
            </div>
          ))}
          {lead &&
            ["predecessor", "successor"].map((name, index) => (
              <LabField key={name} label={index ? "后续任务" : "前置任务"}>
                <MobileSelect name={name} required>
                  <option value="">请选择</option>
                  {data.data?.tasks.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.key} {row.title}
                    </option>
                  ))}
                </MobileSelect>
              </LabField>
            ))}
        </LabDialog>
      )}
    </>
  );
}
