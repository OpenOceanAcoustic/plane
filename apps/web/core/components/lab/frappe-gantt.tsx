/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";
import type { LabGanttChange, LabGanttData, LabGanttTask } from "./gantt-helpers";
import { ganttDay, ganttLabel } from "./gantt-helpers";
// oxlint-disable-next-line import/no-unassigned-import -- Vendor chart CSS is a required side effect.
import "./frappe-gantt.css";
// oxlint-disable-next-line import/no-unassigned-import -- Scope the vendor styles to Plane theme tokens.
import "./gantt-theme.css";

export function LabFrappeGantt({
  workspaceSlug,
  projectId,
  issueIds,
  editable,
  openTask,
  updated,
  quickAdd,
  loadMore,
  canLoadMore,
  refreshKey = "",
}: {
  workspaceSlug: string;
  projectId: string;
  issueIds: string[];
  editable: boolean;
  openTask: (task: LabGanttTask) => void;
  updated: () => Promise<void> | void;
  quickAdd?: ReactNode;
  loadMore?: () => void;
  canLoadMore?: boolean;
  refreshKey?: string;
}) {
  const store = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const chartRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<LabGanttData>();
  const [view, setView] = useState("Week");
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ token: string; changes: LabGanttChange[] }>();
  const [editing, setEditing] = useState<LabGanttTask>();
  const [dependencies, setDependencies] = useState(false);
  const visibleKey = issueIds.join(",");
  const base = `projects/${projectId}/gantt/`;
  const visible = useMemo(() => new Set(visibleKey.split(",").filter(Boolean)), [visibleKey]);
  const tasks = useMemo(() => (data?.tasks ?? []).filter((task) => visible.has(task.id)), [data, visible]);
  const load = useCallback(async () => {
    const next = await store.request<LabGanttData>(base);
    setData(next);
  }, [store, base]);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void run(load);
  }, [run, load, refreshKey]);
  const propose = useCallback(
    async (issueId: string, start: string, end: string) => {
      await run(async () => {
        const result = await store.request<{ token: string; changes: LabGanttChange[] }>(base + "preview/", "POST", {
          issue_id: issueId,
          start_date: start,
          target_date: end,
        });
        setPreview(result);
        setEditing(undefined);
      });
    },
    [run, store, base]
  );
  useEffect(() => {
    let cancelled = false;
    const element = chartRef.current;
    if (!element || !data) return;
    element.replaceChildren();
    const scheduled = tasks.filter((task) => task.start_date && task.target_date);
    if (!scheduled.length) return;
    let chart: import("frappe-gantt").default | undefined;
    import("frappe-gantt")
      .then(({ default: Gantt }) => {
        if (cancelled) return null;
        chart = new Gantt(
          element,
          scheduled.map((task) => ({
            id: task.id,
            name: ganttLabel(`${task.key} · ${task.title}`),
            start: task.start_date!,
            end: task.target_date!,
            progress: task.state_group === "completed" ? 100 : 0,
            dependencies: data.dependencies
              .filter(
                (edge) => edge.successor_id === task.id && scheduled.some((row) => row.id === edge.predecessor_id)
              )
              .map((edge) => edge.predecessor_id)
              .join(","),
          })),
          {
            view_mode: view,
            language: "zh",
            readonly: !editable || busy,
            readonly_progress: true,
            move_dependencies: false,
            popup: false,
            snap_at: "1d",
            container_height: 500,
            on_click: (task) => {
              const row = tasks.find((t) => t.id === task.id);
              if (row) openTask(row);
            },
            on_date_change: (task, start, end) => {
              setEpoch((value) => value + 1);
              void propose(task.id, ganttDay(start), ganttDay(end));
            },
          }
        );
        const todayButton = element.querySelector(".today-button");
        if (todayButton) todayButton.textContent = "今天";
        return chart;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "甘特图加载失败");
      });
    return () => {
      cancelled = true;
      chart?.destroy();
      element.replaceChildren();
    };
  }, [data, tasks, view, epoch, editable, busy, openTask, propose]);
  return (
    <section
      data-testid="lab-project-gantt"
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4 text-primary"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-14 font-semibold">项目甘特图</h2>
        <select
          aria-label="甘特图时间尺度"
          className={`${labInputClass} w-auto`}
          value={view}
          onChange={(event) => setView(event.target.value)}
        >
          <option value="Day">日</option>
          <option value="Week">周</option>
          <option value="Month">月</option>
          <option value="Year">年</option>
        </select>
        <Button size="sm" variant="neutral-primary" onClick={() => setDependencies(true)}>
          任务依赖
        </Button>
        <Button size="sm" variant="neutral-primary" loading={busy} onClick={() => void run(load)}>
          刷新
        </Button>
      </header>
      {error && (
        <p role="alert" className="text-red-500 rounded-md border border-subtle bg-layer-1 p-3 text-13">
          {error}
        </p>
      )}
      {!data ? (
        <p className="p-6 text-13 text-secondary">正在读取任务日期…</p>
      ) : !tasks.length ? (
        <p className="p-6 text-13 text-secondary">没有符合当前筛选条件的任务</p>
      ) : (
        <>
          <div ref={chartRef} className="lab-frappe-gantt min-h-24 overflow-auto rounded-lg border border-subtle" />
          {[false, true].map((unscheduled) => (
            <div key={String(unscheduled)} className="flex flex-col gap-2">
              <h3 className="text-13 font-medium">{unscheduled ? "未排期任务" : "已排期任务"}</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                {tasks
                  .filter((task) => !(task.start_date && task.target_date) === unscheduled)
                  .map((task) => (
                    <div
                      data-testid={`gantt-task-${task.id}`}
                      key={task.id}
                      className="flex items-center gap-2 rounded border border-subtle px-3 py-2 text-12"
                    >
                      <button
                        className="mr-auto min-w-0 truncate text-left hover:text-accent-primary"
                        onClick={() => openTask(task)}
                      >
                        <span>{task.key} · </span>
                        <span>{task.title}</span>
                      </button>
                      <span className="shrink-0 text-secondary">
                        {task.start_date && task.target_date ? `${task.start_date} → ${task.target_date}` : "未排期"}
                      </span>
                      {task.external_dependency && (
                        <span title="包含项目外或当前不可见依赖；修改日期时将校验相关约束" className="text-orange-500">
                          关联约束
                        </span>
                      )}
                      {editable && (
                        <button className="shrink-0 text-accent-primary" onClick={() => setEditing(task)}>
                          排期
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
      {canLoadMore && (
        <Button size="sm" variant="neutral-primary" onClick={loadMore}>
          加载更多任务
        </Button>
      )}
      {quickAdd}
      {editing && (
        <LabDialog
          title={`调整排期 · ${editing.key}`}
          onClose={() => setEditing(undefined)}
          busy={busy}
          onSubmit={async (form) => {
            await propose(editing.id, String(form.get("start")), String(form.get("end")));
          }}
        >
          <LabField label="开始日期">
            <input
              name="start"
              type="date"
              className={labInputClass}
              required
              defaultValue={editing.start_date ?? ""}
            />
          </LabField>
          <LabField label="截止日期">
            <input name="end" type="date" className={labInputClass} required defaultValue={editing.target_date ?? ""} />
          </LabField>
          {error && (
            <p role="alert" className="text-red-500 text-13">
              {error}
            </p>
          )}
        </LabDialog>
      )}
      {preview && (
        <LabDialog
          title="确认日期联动"
          busy={busy}
          onClose={() => {
            setPreview(undefined);
            setEpoch((value) => value + 1);
          }}
          onSubmit={async () => {
            await run(async () => {
              await store.request(base + "commit/", "POST", { token: preview.token });
              setPreview(undefined);
              await load();
              await updated();
            });
          }}
        >
          <p className="text-13 text-secondary">
            将更新以下 {preview.changes.length} 项任务。后续任务保留时长，仅顺延违反依赖的日期。
          </p>
          <div className="max-h-80 space-y-3 overflow-auto">
            {preview.changes.map((change) => (
              <div key={change.id} className="rounded-md border border-subtle p-3 text-13">
                <strong>
                  {change.key} · {change.title}
                </strong>
                <p className="mt-1 text-secondary">
                  {change.old_start_date ?? "未排期"} ～ {change.old_target_date ?? "未排期"}
                </p>
                <p className="text-accent-primary">
                  → {change.start_date} ～ {change.target_date}
                </p>
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-red-500 text-13">
              {error}
            </p>
          )}
        </LabDialog>
      )}
      {dependencies && data && (
        <LabDialog
          title="任务依赖"
          busy={busy}
          onClose={() => setDependencies(false)}
          onSubmit={async (form) => {
            if (!editable) {
              setDependencies(false);
              return;
            }
            await run(async () => {
              await store.request(base + "dependencies/", "POST", {
                predecessor_id: form.get("predecessor"),
                successor_id: form.get("successor"),
              });
              await load();
            });
          }}
        >
          {editable && (
            <>
              <LabField label="前置任务">
                <select name="predecessor" className={labInputClass} required>
                  <option value="">请选择</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.key} · {task.title}
                    </option>
                  ))}
                </select>
              </LabField>
              <LabField label="后续任务">
                <select name="successor" className={labInputClass} required>
                  <option value="">请选择</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.key} · {task.title}
                    </option>
                  ))}
                </select>
              </LabField>
            </>
          )}
          <p className="text-12 text-secondary">
            后续任务最早在前置任务截止日期的次日开始。新增关系后，日期变更仍需预览确认。
          </p>
          <ul className="max-h-56 space-y-2 overflow-auto">
            {data.dependencies
              .filter((edge) => visible.has(edge.predecessor_id) || visible.has(edge.successor_id))
              .map((edge) => (
                <li key={edge.id} className="flex items-center gap-2 text-12">
                  <span className="mr-auto">
                    {data.tasks.find((task) => task.id === edge.predecessor_id)?.key} →{" "}
                    {data.tasks.find((task) => task.id === edge.successor_id)?.key}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      className="text-red-500"
                      onClick={() =>
                        void run(async () => {
                          await store.request(base + "dependencies/", "DELETE", { id: edge.id });
                          await load();
                        })
                      }
                    >
                      移除
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {error && (
            <p role="alert" className="text-red-500 text-13">
              {error}
            </p>
          )}
        </LabDialog>
      )}
    </section>
  );
}
