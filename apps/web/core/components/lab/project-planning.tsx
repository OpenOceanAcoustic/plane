/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  ExternalLink,
  FolderKanban,
  Layers,
  ListTodo,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { v4 as uuidv4 } from "uuid";
import useSWR from "swr";
import type { LabStore } from "@plane/shared-state";
import { Button, labInputClass } from "@plane/ui";
import type { LabGanttData, LabGanttTask } from "./gantt-helpers";
import type { LabOpenProjectIssue } from "./item-details";
import { IssueService } from "@/services/issue/issue.service";
// oxlint-disable-next-line import/no-unassigned-import -- multi-level planning board styles
import "./project-planning.css";

type PlanningRow = {
  task: LabGanttTask;
  depth: number;
  children: PlanningRow[];
  start: string | null;
  end: string | null;
  progress: number;
  leafCount: number;
  doneCount: number;
};

const DAY_MS = 86_400_000;
const ROW_HEIGHT = 38;
const HEADER_HEIGHT = 56;
const TABLE_WIDTH = 560;
const levels = [
  { key: "phase", label: "阶段", Icon: Layers },
  { key: "group", label: "任务组", Icon: FolderKanban },
  { key: "task", label: "任务", Icon: ListTodo },
  { key: "subtask", label: "子任务", Icon: CornerDownRight },
] as const;

const dayOf = (value: string) => Math.floor(Date.parse(`${value}T00:00:00Z`) / DAY_MS);
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const shortDate = (value: string | null | undefined) => (value ? value.slice(5).replace("-", "/") : "—");
const monthStart = (day: number) => {
  const date = new Date(day * DAY_MS);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY_MS;
};
const monthEnd = (day: number) => {
  const date = new Date(day * DAY_MS);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0) / DAY_MS;
};
const minDate = (values: (string | null | undefined)[]) =>
  values
    .flatMap((value) => (value ? [value] : []))
    .reduce<string | null>((min, value) => (!min || value < min ? value : min), null);
const maxDate = (values: (string | null | undefined)[]) =>
  values
    .flatMap((value) => (value ? [value] : []))
    .reduce<string | null>((max, value) => (!max || value > max ? value : max), null);

function buildTree(tasks: LabGanttTask[]): PlanningRow[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const childMap = new Map<string, LabGanttTask[]>();
  const roots: LabGanttTask[] = [];
  for (const task of tasks) {
    if (task.parent_id && byId.has(task.parent_id)) {
      childMap.set(task.parent_id, [...(childMap.get(task.parent_id) ?? []), task]);
    } else {
      roots.push(task);
    }
  }
  const build = (task: LabGanttTask, depth: number): PlanningRow => {
    const children = (childMap.get(task.id) ?? []).map((child) => build(child, depth + 1));
    const start = task.start_date ?? minDate(children.map((child) => child.start));
    const end = task.target_date ?? maxDate(children.map((child) => child.end));
    const leafCount = children.length ? children.reduce((sum, child) => sum + child.leafCount, 0) : 1;
    const doneCount = children.length
      ? children.reduce((sum, child) => sum + child.doneCount, 0)
      : task.state_group === "completed"
        ? 1
        : 0;
    return {
      task,
      depth,
      children,
      start,
      end,
      leafCount,
      doneCount,
      progress: leafCount ? Math.round((doneCount / leafCount) * 100) : 0,
    };
  };
  return roots.map((task) => build(task, 0));
}

function flatten(rows: PlanningRow[], collapsed: Set<string>): PlanningRow[] {
  return rows.flatMap((row) => [
    row,
    ...(row.children.length && !collapsed.has(row.task.id) ? flatten(row.children, collapsed) : []),
  ]);
}

function ProjectPlanning({
  store,
  projectId,
  openProjectIssue,
  onProject,
}: {
  store: LabStore;
  projectId: string;
  openProjectIssue?: LabOpenProjectIssue;
  onProject: (projectId: string) => void;
}) {
  const { data, error, isLoading, mutate } = useSWR(["lab-project-planning", store.slug, projectId], () =>
    store.request<LabGanttData>(`projects/${projectId}/gantt/`)
  );
  const [scale, setScale] = useState<"week" | "month">("week");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ parentId: string | null }>();
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState("");
  const [creating, setCreating] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const issueService = useMemo(() => new IssueService(), []);
  useEffect(() => {
    setCollapsed(new Set());
    setAdding(undefined);
    setAddValue("");
    setAddError("");
  }, [projectId]);
  useEffect(() => {
    if (!adding) return;
    const frame = requestAnimationFrame(() => {
      addInputRef.current?.focus();
      addInputRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [adding]);
  const tree = useMemo(() => buildTree(data?.tasks ?? []), [data]);
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  const tasks = data?.tasks ?? [];
  const scheduled = tasks.filter((task) => task.start_date && task.target_date).length;
  const phases = tree.filter((row) => row.children.length > 0).length;
  const dayWidth = scale === "week" ? 22 : 9;
  const todayDay = dayOf(today());
  const validStarts = rows.flatMap((row) => (row.start ? [row.start] : []));
  const validEnds = rows.flatMap((row) => (row.end ? [row.end] : []));
  const firstDay = validStarts.length
    ? dayOf(validStarts.reduce((min, value) => (value < min ? value : min)))
    : todayDay;
  const lastDay = validEnds.length
    ? dayOf(validEnds.reduce((max, value) => (value > max ? value : max)))
    : todayDay + 45;
  const rangeStart = monthStart(firstDay - 3);
  const rangeEnd = monthEnd(lastDay + 3);
  const totalDays = rangeEnd - rangeStart + 1;
  const timelineWidth = totalDays * dayWidth;
  const months = useMemo(() => {
    const result: { key: string; label: string; days: number }[] = [];
    let cursor = rangeStart;
    while (cursor <= rangeEnd) {
      const date = new Date(cursor * DAY_MS);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      const next = Date.UTC(year, month + 1, 1) / DAY_MS;
      const end = Math.min(rangeEnd, next - 1);
      result.push({ key: `${year}-${month}`, label: `${year}年${month + 1}月`, days: end - cursor + 1 });
      cursor = end + 1;
    }
    return result;
  }, [rangeStart, rangeEnd]);
  const weeks = useMemo(() => {
    const result: { key: number; left: number; label: string }[] = [];
    for (let day = rangeStart; day <= rangeEnd; day += 7) {
      result.push({ key: day, left: (day - rangeStart) * dayWidth, label: shortDate(dateOf(day)) });
    }
    return result;
  }, [rangeStart, rangeEnd, dayWidth]);
  const todayOffset = (todayDay - rangeStart) * dayWidth;
  const showToday = todayDay >= rangeStart && todayDay <= rangeEnd;
  const openTask = (task: LabGanttTask) => {
    if (openProjectIssue) openProjectIssue({ issue_id: task.id, project_id: projectId });
    else window.location.assign(`/${store.slug}/projects/${projectId}/issues/${task.id}`);
  };
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startAdding = (row?: PlanningRow) => {
    setAdding({ parentId: row?.task.id ?? null });
    setAddValue("");
    setAddError("");
    if (row?.children.length)
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(row.task.id);
        return next;
      });
  };
  const cancelAdding = () => {
    setAdding(undefined);
    setAddValue("");
    setAddError("");
  };
  const submitAdd = async () => {
    if (!adding || creating) return;
    const name = addValue.trim();
    if (!name) {
      addInputRef.current?.focus();
      return;
    }
    setCreating(true);
    setAddError("");
    try {
      await issueService.createIssue(store.slug, projectId, {
        id: uuidv4(),
        name,
        parent_id: adding.parentId,
        priority: "none",
        label_ids: [],
        assignee_ids: [],
      });
      setAddValue("");
      await mutate();
      requestAnimationFrame(() => addInputRef.current?.focus());
    } catch (problem) {
      setAddError(
        problem instanceof Error
          ? problem.message
          : typeof problem === "string"
            ? problem
            : "创建失败，请检查标题和项目权限"
      );
    } finally {
      setCreating(false);
    }
  };
  const focusRow = (id: string) => {
    const element = rowRefs.current.get(id);
    element?.focus();
    element?.scrollIntoView({ block: "nearest" });
  };
  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, row: PlanningRow, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = rows[index + 1];
      if (next) focusRow(next.task.id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const previous = rows[index - 1];
      if (previous) focusRow(previous.task.id);
    } else if (event.key === "ArrowRight") {
      if (row.children.length) {
        event.preventDefault();
        setCollapsed((current) => {
          const next = new Set(current);
          next.delete(row.task.id);
          return next;
        });
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.children.length && !collapsed.has(row.task.id)) {
        setCollapsed((current) => new Set(current).add(row.task.id));
      } else if (row.task.parent_id) {
        focusRow(row.task.parent_id);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      openTask(row.task);
    } else if (event.key === "n" || event.key === "N" || event.key === "+") {
      event.preventDefault();
      startAdding(row);
    }
  };
  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        startAdding();
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  });
  const displayRows = useMemo(() => {
    const result: (
      | { type: "task"; row: PlanningRow; index: number }
      | { type: "add"; parentId: string | null; depth: number }
    )[] = [];
    rows.forEach((row, index) => {
      result.push({ type: "task", row, index });
      if (adding && adding.parentId === row.task.id)
        result.push({ type: "add", parentId: row.task.id, depth: row.depth + 1 });
    });
    if (adding && adding.parentId === null) result.push({ type: "add", parentId: null, depth: 0 });
    return result;
  }, [rows, adding]);
  const project = store.planner?.projects.find((row) => row.id === projectId);
  return (
    <section className="lab-planning" aria-label="项目规划">
      <div className="lab-planning-toolbar">
        <label className="lab-planning-project">
          <span className="whitespace-nowrap">项目</span>
          <select
            aria-label="规划项目"
            className={labInputClass}
            value={projectId}
            onChange={(event) => onProject(event.target.value)}
          >
            {store.planner?.projects.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <div className="lab-planning-stats">
          <span className="lab-planning-stat">
            共 <strong>{tasks.length}</strong> 项
          </span>
          <span className="lab-planning-stat">
            已排期 <strong>{scheduled}</strong>
          </span>
          <span className="lab-planning-stat">
            未排期 <strong>{tasks.length - scheduled}</strong>
          </span>
          <span className="lab-planning-stat">
            阶段 <strong>{phases}</strong>
          </span>
        </div>
        <div className="lab-planning-toolbar-actions">
          <Button size="sm" variant="primary" onClick={() => startAdding()}>
            <Plus size={13} className="mr-1" />
            新增工作项
          </Button>
          <div className="lab-planning-scale" role="group" aria-label="时间尺度">
            <button type="button" aria-pressed={scale === "week"} onClick={() => setScale("week")}>
              周
            </button>
            <button type="button" aria-pressed={scale === "month"} onClick={() => setScale("month")}>
              月
            </button>
          </div>
          <Button size="sm" variant="neutral-primary" loading={isLoading} onClick={() => void mutate()}>
            <RefreshCw size={13} className="mr-1" />
            刷新
          </Button>
          <a className="lab-planning-open" href={`/${store.slug}/projects/${projectId}/issues`}>
            打开工作项
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <div className="lab-planning-legend" aria-label="层级图例">
        {levels.map((level) => (
          <span key={level.key} className="lab-planning-legend-item" data-level={level.key}>
            <span className="lab-planning-legend-dot" aria-hidden="true" />
            {level.label}
          </span>
        ))}
        <span className="lab-planning-legend-item" data-level="unscheduled">
          <span className="lab-planning-legend-dot" aria-hidden="true" />
          未排期
        </span>
        {project && <span className="ml-auto text-tertiary">{project.name}</span>}
        <span className="lab-planning-shortcuts">N 新增 · ↑↓ 选择 · → 展开 · ← 收起 · Enter 打开</span>
      </div>
      {addError && (
        <p role="alert" className="lab-planning-add-error">
          {addError}
        </p>
      )}

      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          {error instanceof Error ? error.message : "项目规划读取失败"}
        </p>
      )}
      {isLoading && <p className="text-13 text-secondary">正在读取项目规划…</p>}
      {!isLoading && !error && !displayRows.length && (
        <div className="lab-planning-empty">
          <p>当前项目还没有工作项。先从第一条工作项开始，后续可以继续添加子项。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => startAdding()}>
              <Plus size={13} className="mr-1" />
              新增工作项
            </Button>
            <a className="lab-planning-open" href={`/${store.slug}/projects/${projectId}/issues`}>
              打开工作项
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      {!!displayRows.length && (
        <div className="lab-planning-scroll">
          <div className="lab-planning-grid" style={{ width: TABLE_WIDTH + timelineWidth }}>
            <div className="lab-planning-table">
              <div className="lab-planning-table-head">
                <span>编号</span>
                <span>标题</span>
                <span>负责人</span>
                <span>开始</span>
                <span>结束</span>
                <span>状态</span>
              </div>
              {displayRows.map((entry) => {
                if (entry.type === "add")
                  return (
                    <div
                      key={`add-${entry.parentId ?? "root"}`}
                      className="lab-planning-add-row"
                      style={{ paddingLeft: 14 + entry.depth * 13 }}
                    >
                      <CornerDownRight size={12} className="shrink-0 text-tertiary" aria-hidden="true" />
                      <input
                        ref={addInputRef}
                        className="lab-planning-add-input"
                        value={addValue}
                        onChange={(event) => setAddValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitAdd();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            cancelAdding();
                          }
                        }}
                        placeholder="输入标题，Enter 确认"
                        maxLength={255}
                        aria-label="新工作项标题"
                        disabled={creating}
                      />
                      <span className="lab-planning-add-hint">Enter</span>
                      <button
                        type="button"
                        className="lab-planning-add-submit"
                        disabled={creating || !addValue.trim()}
                        onClick={() => void submitAdd()}
                      >
                        {creating ? "添加中…" : "添加"}
                      </button>
                      <button
                        type="button"
                        className="lab-planning-add-cancel"
                        aria-label="取消新增"
                        onClick={cancelAdding}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                const { row, index } = entry;
                const levelIndex = row.children.length ? (row.depth === 0 ? 0 : 1) : row.depth <= 1 ? 2 : 3;
                const level = levels[levelIndex]!;
                const LevelIcon = level.Icon;
                const names = row.task.assignee_names?.filter(Boolean) ?? [];
                return (
                  <div
                    key={row.task.id}
                    ref={(element) => {
                      if (element) rowRefs.current.set(row.task.id, element);
                      else rowRefs.current.delete(row.task.id);
                    }}
                    className="lab-planning-table-row"
                    data-depth={Math.min(row.depth, 3)}
                    data-level={level.key}
                    style={{ "--depth": Math.min(row.depth, 3) } as CSSProperties}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- row contains nested action buttons
                    role="button"
                    tabIndex={0}
                    title={`${row.task.key} · ${row.task.title} · Enter 打开 · N 新增子项`}
                    onClick={() => openTask(row.task)}
                    onKeyDown={(event) => onRowKeyDown(event, row, index)}
                  >
                    <span className="lab-planning-key">{row.task.key}</span>
                    <span className="lab-planning-title">
                      {row.children.length ? (
                        <button
                          type="button"
                          className="lab-planning-expand"
                          aria-expanded={!collapsed.has(row.task.id)}
                          aria-label={collapsed.has(row.task.id) ? `展开${row.task.title}` : `收起${row.task.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(row.task.id);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {collapsed.has(row.task.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        </button>
                      ) : (
                        <span className="lab-planning-expand-placeholder" />
                      )}
                      <LevelIcon size={12} className="shrink-0" aria-hidden="true" />
                      <span className="lab-planning-title-text">{row.task.title}</span>
                      <span className="lab-planning-level" data-level={level.key}>
                        {level.label}
                      </span>
                      <button
                        type="button"
                        className="lab-planning-add"
                        title="在此项下新增子工作项（N）"
                        aria-label={`在${row.task.title}下新增子工作项`}
                        onClick={(event) => {
                          event.stopPropagation();
                          startAdding(row);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Plus size={12} />
                      </button>
                    </span>
                    <span className="lab-planning-owner" title={names.join("、") || "未指派"}>
                      {names.length ? (
                        <>
                          <span className="lab-planning-owner-avatar" aria-hidden="true">
                            {names[0]!.slice(0, 1)}
                          </span>
                          <span>
                            {names[0]}
                            {names.length > 1 ? ` +${names.length - 1}` : ""}
                          </span>
                        </>
                      ) : (
                        "未指派"
                      )}
                    </span>
                    <span className="lab-planning-date">{shortDate(row.start)}</span>
                    <span className="lab-planning-date">{shortDate(row.end)}</span>
                    <span className="lab-planning-status" data-group={row.task.state_group}>
                      {row.task.state || "未设置"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              className="lab-planning-timeline"
              style={{ width: timelineWidth, "--day-width": `${dayWidth}px` } as CSSProperties}
            >
              <div className="lab-planning-timeline-head">
                <div className="lab-planning-months">
                  {months.map((month) => (
                    <div key={month.key} className="lab-planning-month" style={{ width: month.days * dayWidth }}>
                      {month.label}
                    </div>
                  ))}
                </div>
                <div className="lab-planning-weeks">
                  {weeks.map((week) => (
                    <span
                      key={week.key}
                      className="lab-planning-week-tick"
                      style={{ left: week.left, width: dayWidth * 7 }}
                    >
                      {week.label}
                    </span>
                  ))}
                </div>
              </div>
              {displayRows.map((entry) => {
                if (entry.type === "add")
                  return (
                    <div
                      key={`add-${entry.parentId ?? "root"}`}
                      className="lab-planning-timeline-row lab-planning-add-timeline"
                      style={{ height: ROW_HEIGHT }}
                    >
                      <span className="lab-planning-unscheduled">新工作项</span>
                    </div>
                  );
                const { row } = entry;
                const levelIndex = row.children.length ? (row.depth === 0 ? 0 : 1) : row.depth <= 1 ? 2 : 3;
                const level = levels[levelIndex]!;
                const milestone = !!row.start && row.start === row.end;
                const summary = !row.task.start_date || !row.task.target_date;
                const start = row.start ? Math.max(dayOf(row.start), rangeStart) : null;
                const end = row.end ? Math.min(dayOf(row.end), rangeEnd) : null;
                const left = start === null ? 0 : (start - rangeStart) * dayWidth;
                const width = start === null || end === null ? 0 : Math.max(dayWidth, (end - start + 1) * dayWidth);
                return (
                  <div
                    key={row.task.id}
                    className="lab-planning-timeline-row"
                    data-depth={Math.min(row.depth, 3)}
                    data-level={level.key}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {start !== null && end !== null ? (
                      <button
                        type="button"
                        className="lab-planning-bar"
                        data-level={level.key}
                        data-summary={summary ? "true" : undefined}
                        data-milestone={milestone ? "true" : undefined}
                        style={{ left, width: milestone ? 13 : width }}
                        title={`${row.task.key} · ${row.task.title} · ${row.progress}%`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openTask(row.task);
                        }}
                      >
                        <span className="lab-planning-bar-fill" style={{ width: `${row.progress}%` }} />
                        {!milestone && (
                          <span className="lab-planning-bar-label">
                            {level.label} · {row.progress}%
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="lab-planning-unscheduled">未排期</span>
                    )}
                  </div>
                );
              })}
              {showToday && (
                <div
                  className="lab-planning-today"
                  style={{ left: todayOffset, top: HEADER_HEIGHT, height: displayRows.length * ROW_HEIGHT }}
                >
                  <span>今天</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function LabProjectPlanning({
  store,
  refreshKey = 0,
  openProjectIssue,
}: {
  store: LabStore;
  refreshKey?: number;
  openProjectIssue?: LabOpenProjectIssue;
}) {
  const [params, setParams] = useSearchParams();
  const projects = store.planner?.projects ?? [];
  const projectId = params.get("project_id") ?? (projects.length === 1 ? projects[0]!.id : "");
  if (!projectId)
    return (
      <section className="lab-planning-empty" aria-label="选择规划项目">
        <h2 className="text-16 font-semibold">选择项目</h2>
        <div className="lab-planning-picker">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("project_id", project.id);
                  return next;
                })
              }
            >
              <strong>{project.name}</strong>
              <span>项目规划与排期</span>
            </button>
          ))}
        </div>
      </section>
    );
  return (
    <ProjectPlanning
      key={`${projectId}-${refreshKey}`}
      store={store}
      projectId={projectId}
      openProjectIssue={openProjectIssue}
      onProject={(value) =>
        setParams((current) => {
          const next = new URLSearchParams(current);
          if (value) next.set("project_id", value);
          else next.delete("project_id");
          return next;
        })
      }
    />
  );
}
