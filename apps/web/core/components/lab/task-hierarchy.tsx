/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { Fragment, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { ChevronDown, ChevronRight, FolderKanban, Layers2, ListTodo, UserRound } from "lucide-react";
import type { LabItem, LabTaskRow } from "@plane/types";
import { Button, labInputClass } from "@plane/ui";
import { LabItemOverviewSurface } from "./item-details";
import type { LabOpenProjectIssue } from "./item-details";
import { LabTaskTimeline, type TaskTimelineRow } from "./task-timeline";
// oxlint-disable-next-line import/no-unassigned-import -- unified work item hierarchy
import "./task-hierarchy.css";

type TaskNode = { task: LabTaskRow; depth: number; children: number; matches: boolean };
type ProjectTree = { id: string; name: string; rows: TaskNode[]; count: number };
const personalStatuses = { todo: "待做", active: "进行中", review: "待验收", done: "完成" };
const priorities: Record<string, string> = { urgent: "紧急", high: "高", medium: "中", low: "低", none: "—" };

/** Break malformed cycles before traversing; keep ancestors of matching descendants. */
export function taskHierarchy(tasks: LabTaskRow[], query: string, onlyMine: boolean): ProjectTree[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parents = new Map<string, string>();
  for (const task of tasks) {
    const parent = task.parent_id ? byId.get(task.parent_id) : undefined;
    if (parent && parent.project_id === task.project_id && parent.id !== task.id) parents.set(task.id, parent.id);
  }
  const settled = new Set<string>();
  for (const task of tasks) {
    const chain = new Set<string>();
    let id: string | undefined = task.id;
    while (id && !settled.has(id)) {
      if (chain.has(id)) {
        parents.delete(id);
        break;
      }
      chain.add(id);
      id = parents.get(id);
    }
    for (const visited of chain) settled.add(visited);
  }
  const children = new Map<string, LabTaskRow[]>();
  const projects = new Map<string, { name: string; roots: LabTaskRow[] }>();
  for (const task of tasks) {
    if (!projects.has(task.project_id)) projects.set(task.project_id, { name: task.project, roots: [] });
    const parent = parents.get(task.id);
    if (parent) {
      const siblings = children.get(parent) ?? [];
      siblings.push(task);
      children.set(parent, siblings);
    } else projects.get(task.project_id)!.roots.push(task);
  }
  const term = query.trim().toLocaleLowerCase();
  const matches = new Set(
    tasks
      .filter(
        (task) =>
          (!onlyMine || task.is_mine) &&
          [task.title, task.key, task.project, task.state, ...(task.assignees ?? []).map((member) => member.name)]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term)
      )
      .map((task) => task.id)
  );
  const included = new Set(matches);
  for (const id of matches) {
    let parent = parents.get(id);
    while (parent && !included.has(parent)) {
      included.add(parent);
      parent = parents.get(parent);
    }
  }
  return [...projects].flatMap(([id, project]) => {
    // oxlint-disable-next-line unicorn/no-array-reverse -- ES2022 target; reverse only the copy.
    const stack = [...project.roots].reverse().map((task) => ({ task, depth: 0 }));
    const rows: TaskNode[] = [];
    while (stack.length) {
      const node = stack.pop()!;
      if (!included.has(node.task.id)) continue;
      const descendants = (children.get(node.task.id) ?? []).filter((child) => included.has(child.id));
      rows.push({ ...node, children: descendants.length, matches: matches.has(node.task.id) });
      // oxlint-disable-next-line unicorn/no-array-reverse -- ES2022 target; reverse only the copy.
      for (const child of [...descendants].reverse()) stack.push({ task: child, depth: node.depth + 1 });
    }
    return rows.length ? [{ id, name: project.name, rows, count: rows.filter((row) => row.matches).length }] : [];
  });
}

const assignee = (names: string) => (
  <span className="lab-hierarchy-assignee" title={names}>
    <span className="lab-hierarchy-avatar" aria-hidden="true">
      {Array.from(names)[0]}
    </span>
    <span>{names}</span>
  </span>
);

export function LabTaskHierarchy({
  tasks,
  personalItems,
  projectId,
  query,
  workspaceSlug,
  workspaceTimezone = "Asia/Shanghai",
  openProjectIssue,
}: {
  tasks: LabTaskRow[];
  personalItems: LabItem[];
  projectId: string;
  query: string;
  workspaceSlug: string;
  workspaceTimezone?: string;
  openProjectIssue?: LabOpenProjectIssue;
}) {
  const [scope, setScope] = useState("all");
  const [timeline, setTimeline] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [viewing, setViewing] = useState<LabItem>();
  useEffect(() => setCollapsed(new Set()), [query, scope, projectId]);
  const trees = useMemo(
    () => (scope === "personal" ? [] : taskHierarchy(tasks, query, scope === "mine")),
    [tasks, query, scope]
  );
  const personal = personalItems.filter(
    (item) =>
      !projectId &&
      !item.issue_id &&
      !item.archived &&
      [item.title, item.description ?? "", personalStatuses[item.status]]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
  );
  const visibleTrees = trees.map((tree) => {
    let hiddenBelow: number | undefined;
    const rows = collapsed.has(`project:${tree.id}`)
      ? []
      : tree.rows.filter((row) => {
          if (hiddenBelow !== undefined && row.depth > hiddenBelow) return false;
          hiddenBelow = row.children && collapsed.has(row.task.id) ? row.depth : undefined;
          return true;
        });
    return { ...tree, rows };
  });
  const timelineRows: TaskTimelineRow[] = visibleTrees.flatMap((tree): TaskTimelineRow[] => [
    { id: `project:${tree.id}`, title: tree.name, kind: "group", start: null, end: null, depth: 0 },
    ...tree.rows.map(
      ({ task, depth }): TaskTimelineRow => ({
        id: task.id,
        title: task.title,
        kind: "project",
        start: task.start_date,
        end: task.target_date,
        depth,
      })
    ),
  ]);
  if (personal.length) {
    timelineRows.push({ id: "personal", title: "个人工作项", kind: "group", start: null, end: null, depth: 0 });
    if (!collapsed.has("personal"))
      timelineRows.push(
        ...personal.map(
          (item): TaskTimelineRow => ({
            id: `personal:${item.id}`,
            title: item.title,
            kind: "personal",
            start: null,
            end: item.target_date,
            depth: 0,
          })
        )
      );
  }
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const collapseKeys = trees.flatMap((tree) => [
    `project:${tree.id}`,
    ...tree.rows.filter((row) => row.children).map((row) => row.task.id),
  ]);
  const total = trees.reduce((sum, tree) => sum + tree.count, 0) + personal.length;
  const issueHref = (task: LabTaskRow) =>
    `/${workspaceSlug}/projects/${task.project_id}/${task.archived_at ? "archives/" : ""}issues/${task.id}`;
  const openTask = (event: MouseEvent<HTMLAnchorElement>, task: LabTaskRow) => {
    if (openProjectIssue && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      openProjectIssue({ issue_id: task.id, project_id: task.project_id, archived: Boolean(task.archived_at) });
    }
  };
  const expander = (key: string, name: string) => (
    <button
      type="button"
      className="lab-hierarchy-toggle"
      aria-label={`${collapsed.has(key) ? "展开" : "折叠"}${name}`}
      aria-expanded={!collapsed.has(key)}
      onClick={() => toggle(key)}
    >
      {collapsed.has(key) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
    </button>
  );
  return (
    <section className="lab-hierarchy" aria-label="工作项层级">
      <div className="lab-hierarchy-toolbar">
        <select
          aria-label="工作项归属"
          className={`${labInputClass} max-w-44`}
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="all">全部工作项</option>
          <option value="mine">我负责的工作项</option>
          <option value="personal">个人工作项</option>
        </select>
        <span className="lab-hierarchy-kind" data-kind="project">
          项目
        </span>
        <span className="lab-hierarchy-kind" data-kind="personal">
          个人
        </span>
        <Button size="sm" variant="neutral-primary" aria-pressed={timeline} onClick={() => setTimeline(!timeline)}>
          甘特时间轴
        </Button>
        <span className="lab-hierarchy-total">{total} 个工作项</span>
        <Button size="sm" variant="neutral-primary" onClick={() => setCollapsed(new Set())}>
          全部展开
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          onClick={() => setCollapsed(new Set([...collapseKeys, "personal"]))}
        >
          全部折叠
        </Button>
      </div>
      <div className="lab-hierarchy-board-scroll">
        <div className="lab-hierarchy-board" data-timeline={timeline}>
          <div className="lab-hierarchy-list-pane">
            <div className="lab-hierarchy-pane-toolbar">工作项</div>
            <div className="lab-hierarchy-scroll" aria-label="工作项列表滚动区" tabIndex={0}>
              <table aria-label="工作项层级列表">
                <colgroup>
                  <col className="lab-hierarchy-col-key" />
                  <col className="lab-hierarchy-col-title" />
                  <col className="lab-hierarchy-col-state" />
                  <col className="lab-hierarchy-col-date" />
                  <col className="lab-hierarchy-col-date" />
                  <col className="lab-hierarchy-col-owner" />
                  <col className="lab-hierarchy-col-priority" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">编号</th>
                    <th scope="col">标题</th>
                    <th scope="col">状态</th>
                    <th scope="col">开始日期</th>
                    <th scope="col">结束日期</th>
                    <th scope="col">负责人</th>
                    <th scope="col">优先级</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrees.map((tree) => {
                    return (
                      <Fragment key={tree.id}>
                        <tr
                          key={`project:${tree.id}`}
                          data-row-id={`project:${tree.id}`}
                          className="lab-hierarchy-project"
                        >
                          <td colSpan={7}>
                            <div className="lab-hierarchy-title">
                              {expander(`project:${tree.id}`, tree.name)}
                              <FolderKanban size={16} />
                              <strong>{tree.name}</strong>
                              <span className="lab-hierarchy-count">{tree.count}</span>
                            </div>
                          </td>
                        </tr>
                        {tree.rows.flatMap((row) => {
                          return [
                            <tr
                              key={row.task.id}
                              data-row-id={row.task.id}
                              data-kind="project"
                              data-depth={row.depth + 1}
                              data-context={!row.matches || undefined}
                            >
                              <td className="lab-hierarchy-number">
                                <a
                                  href={issueHref(row.task)}
                                  title={row.task.key}
                                  onClick={(event) => openTask(event, row.task)}
                                >
                                  {row.task.key}
                                </a>
                              </td>
                              <td>
                                <div
                                  className="lab-hierarchy-title"
                                  style={{ paddingLeft: `${Math.min(row.depth, 12) * 20}px` }}
                                >
                                  {row.children ? (
                                    expander(row.task.id, row.task.title)
                                  ) : (
                                    <span className="lab-hierarchy-spacer" />
                                  )}
                                  <span
                                    className="lab-hierarchy-level-icon"
                                    data-level={Math.min(row.depth, 2)}
                                    aria-hidden="true"
                                  >
                                    {row.children ? <Layers2 size={12} /> : <ListTodo size={12} />}
                                  </span>
                                  <a
                                    href={issueHref(row.task)}
                                    title={row.task.title}
                                    onClick={(event) => openTask(event, row.task)}
                                  >
                                    {row.task.title}
                                  </a>
                                  {row.task.is_mine && (
                                    <span className="lab-hierarchy-kind" data-kind="personal">
                                      我负责
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td title={row.task.state}>{row.task.state || "—"}</td>
                              <td>{row.task.start_date || "—"}</td>
                              <td>{row.task.target_date || "—"}</td>
                              <td>
                                {row.task.assignees?.length
                                  ? assignee(row.task.assignees.map((member) => member.name).join("、"))
                                  : "未指派"}
                              </td>
                              <td>{priorities[row.task.priority] ?? row.task.priority}</td>
                            </tr>,
                          ];
                        })}
                      </Fragment>
                    );
                  })}
                  {personal.length > 0 && (
                    <tr className="lab-hierarchy-project" data-row-id="personal" data-kind="personal">
                      <td colSpan={7}>
                        <div className="lab-hierarchy-title">
                          {expander("personal", "个人工作项")}
                          <UserRound size={16} />
                          <strong>个人工作项</strong>
                          <span className="lab-hierarchy-count">{personal.length}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!collapsed.has("personal") &&
                    personal.map((item) => (
                      <tr
                        key={`personal:${item.id}`}
                        data-row-id={`personal:${item.id}`}
                        data-kind="personal"
                        data-depth={1}
                      >
                        <td className="lab-hierarchy-number">—</td>
                        <td>
                          <div className="lab-hierarchy-title">
                            <span className="lab-hierarchy-spacer" />
                            <span className="lab-hierarchy-level-icon" aria-hidden="true">
                              <UserRound size={12} />
                            </span>
                            <button
                              className="lab-hierarchy-personal-title"
                              title={item.title}
                              onClick={() => setViewing(item)}
                            >
                              {item.title}
                            </button>
                            <span className="lab-hierarchy-kind" data-kind="personal">
                              个人
                            </span>
                          </div>
                        </td>
                        <td>{personalStatuses[item.status]}</td>
                        <td>—</td>
                        <td>{item.target_date || "—"}</td>
                        <td>{assignee(item.owner_name || "我")}</td>
                        <td>{priorities[item.priority ?? "none"] ?? item.priority}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
          {timeline && (
            <LabTaskTimeline key={projectId || "all"} rows={timelineRows} workspaceTimezone={workspaceTimezone} />
          )}
        </div>
      </div>
      {!total && <p className="lab-hierarchy-empty">没有符合条件的工作项</p>}
      {viewing && (
        <LabItemOverviewSurface title="个人工作项" onClose={() => setViewing(undefined)}>
          <h2 className="text-20 font-semibold break-words">{viewing.title}</h2>
          <p className="text-14 break-words whitespace-pre-wrap">{viewing.description || "暂无说明"}</p>
          <dl className="grid grid-cols-2 gap-4 text-13">
            <div>
              <dt className="text-secondary">状态</dt>
              <dd>{personalStatuses[viewing.status]}</dd>
            </div>
            <div>
              <dt className="text-secondary">截止日期</dt>
              <dd>{viewing.target_date || "—"}</dd>
            </div>
          </dl>
          <a className="text-13 text-accent-primary" href={`/${workspaceSlug}/lab/planner`}>
            打开个人规划
          </a>
        </LabItemOverviewSurface>
      )}
    </section>
  );
}
