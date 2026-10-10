/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { MobileSelect } from "../../components/select";
import { useState, useEffect } from "react";
import type { LabCustomField, LabTaskTableData, LabTaskRow, LabFieldKind, LabMember } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { LabDialog, LabField, Button, Empty, ErrorMessage } from "./ui";
const names: Record<LabFieldKind, string> = {
  text: "文本",
  number: "数字",
  single_select: "单选",
  multi_select: "多选",
  date: "日期",
  member: "成员",
  boolean: "是／否",
  url: "网址",
};
const valueFor = (row: LabTaskRow, key: string): unknown =>
  key.startsWith("field:") ? row.values[key.slice(6)] : row[key as keyof LabTaskRow];
const textFor = (value: unknown): string =>
  value === null || value === undefined || value === ""
    ? "—"
    : Array.isArray(value)
      ? value.map(textFor).join("、")
      : typeof value === "boolean"
        ? value
          ? "是"
          : "否"
        : String(value);

export function Fields({
  store,
  projectId = "",
  onOpenIssue,
}: {
  store: LabStore;
  projectId?: string;
  onOpenIssue?: (project: string, issue: string) => void;
}) {
  const data = useResource<LabTaskTableData>(store, `task-table/${projectId ? `?project=${projectId}` : ""}`);
  const definitions = useResource<{ fields: LabCustomField[]; can_manage: boolean }>(store, "field-definitions/");
  const project = useResource<{ fields: LabCustomField[]; can_manage: boolean; members: LabMember[] }>(
    store,
    projectId ? `projects/${projectId}/fields/` : null
  );
  const [editing, setEditing] = useState<LabCustomField | "new">();
  const [kind, setKind] = useState<LabFieldKind>("text");
  const [selected, setSelected] = useState<LabTaskRow>();
  const [query, setQuery] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupBy, setGroupBy] = useState("state");
  const [sortBy, setSortBy] = useState("target_date");
  const [direction, setDirection] = useState("asc");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set(["project", "start_date"]));
  useEffect(() => {
    setSelected(undefined);
    setEditing(undefined);
  }, [projectId]);
  const refresh = async () => {
    await Promise.all([data.refresh(), definitions.refresh(), ...(projectId ? [project.refresh()] : [])]);
  };
  const columns = [
    { key: "project", label: "项目" },
    { key: "state", label: "状态" },
    { key: "priority", label: "优先级" },
    { key: "start_date", label: "开始日期" },
    { key: "target_date", label: "截止日期" },
    ...(data.data?.fields ?? [])
      .filter((field) => field.enabled)
      .map((field) => ({ key: `field:${field.id}`, label: field.name })),
  ];
  const rows = (data.data?.tasks ?? [])
    .filter((row) =>
      `${row.title} ${row.key} ${Object.values(row.values).map(textFor).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022; sorts a newly filtered list
    .sort((left, right) => {
      const a = valueFor(left, sortBy),
        b = valueFor(right, sortBy);
      const difference =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : textFor(a).localeCompare(textFor(b), "zh-CN", { numeric: true });
      return direction === "desc" ? -difference : difference;
    });
  const groups = new Map<string, LabTaskRow[]>();
  for (const row of rows) {
    const label = groupBy === "none" ? "任务记录" : textFor(valueFor(row, groupBy));
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return (
    <>
      <div className="lab-section-heading">
        <h3>任务表格</h3>
        <div className="lab-actions">
          <Button onClick={() => setSettingsOpen(true)}>显示列 / 排序</Button>
          <Button onClick={() => void refresh().catch(() => {})}>刷新</Button>
        </div>
      </div>
      <ErrorMessage error={data.error || definitions.error || project.error} />
      <input
        className="lab-input"
        aria-label="搜索任务记录"
        placeholder="搜索任务"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="lab-calendar-chips" role="group" aria-label="任务分组">
        {[
          { id: "none", name: "不分组" },
          { id: "state", name: "按状态" },
          { id: "priority", name: "按优先级" },
          ...(data.data?.fields ?? [])
            .filter((field) => field.enabled)
            .map((field) => ({ id: `field:${field.id}`, name: `按${field.name}` })),
        ].map((entry) => (
          <button
            key={entry.id}
            className={groupBy === entry.id ? "active" : ""}
            aria-pressed={groupBy === entry.id}
            onClick={() => setGroupBy(entry.id)}
          >
            {entry.name}
          </button>
        ))}
      </div>
      <Button onClick={() => setManagerOpen(true)}>管理字段</Button>
      {managerOpen && (
        <LabDialog title="管理自定义字段" onClose={() => setManagerOpen(false)}>
          {definitions.data?.can_manage && (
            <Button
              onClick={() => {
                setKind("text");
                setEditing("new");
              }}
            >
              新建字段
            </Button>
          )}
          {definitions.data?.fields.map((field) => (
            <article key={field.id} className="lab-card">
              <div className="lab-heading">
                <h3>{field.name}</h3>
                <span className="lab-muted">
                  {names[field.kind]}
                  {field.archived ? " · 停用" : ""}
                </span>
              </div>
              <div className="lab-actions">
                {definitions.data?.can_manage && (
                  <Button
                    onClick={() => {
                      setKind(field.kind);
                      setEditing(field);
                    }}
                  >
                    编辑
                  </Button>
                )}
                {project.data?.can_manage && !field.archived && (
                  <label className="lab-switch-field">
                    <span>在当前项目启用</span>
                    <input
                      type="checkbox"
                      checked={!!project.data.fields.find((row) => row.id === field.id)?.enabled}
                      onChange={(event) => {
                        const ids = project
                          .data!.fields.filter((row) => row.enabled && !row.archived && row.id !== field.id)
                          .map((row) => row.id);
                        if (event.target.checked) ids.push(field.id);
                        void store
                          .execute(async () => {
                            await store.request(`projects/${projectId}/fields/`, "PUT", { ids });
                            await refresh();
                          })
                          .catch(() => {});
                      }}
                    />
                  </label>
                )}
              </div>
            </article>
          ))}
        </LabDialog>
      )}
      {Array.from(groups, ([label, tasks]) => (
        <section key={label}>
          <h3 className="lab-section-heading">
            {label} · {tasks.length}
          </h3>
          <div className="lab-data-records">
            {tasks.map((row) => (
              <article className="lab-data-record" key={row.id}>
                <header className="lab-data-record-heading">
                  <span>{row.key}</span>
                  <h3>
                    {onOpenIssue ? (
                      <button onClick={() => onOpenIssue(row.project_id, row.id)}>{row.title}</button>
                    ) : (
                      row.title
                    )}
                  </h3>
                </header>
                <dl>
                  {columns
                    .filter((column) => !hiddenColumns.has(column.key))
                    .map((column) => (
                      <div className="lab-data-record-field" key={column.key}>
                        <dt>{column.label}</dt>
                        <dd>{textFor(valueFor(row, column.key))}</dd>
                      </div>
                    ))}
                </dl>
                <div className="lab-actions lab-record-actions">
                  {row.editable && <Button onClick={() => setSelected(row)}>编辑任务自定义值</Button>}
                  {onOpenIssue && <Button onClick={() => onOpenIssue(row.project_id, row.id)}>任务详情</Button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {data.data && !rows.length && <Empty>所选范围暂无任务记录。</Empty>}
      {settingsOpen && (
        <LabDialog
          title="表格显示与筛选"
          onClose={() => setSettingsOpen(false)}
          onSubmit={async () => setSettingsOpen(false)}
          submitLabel="应用"
        >
          <LabField label="任务分组">
            <MobileSelect value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              <option value="none">不分组</option>
              {columns
                .filter(
                  (column) => column.key === "state" || column.key === "priority" || column.key.startsWith("field:")
                )
                .map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
            </MobileSelect>
          </LabField>
          <LabField label="排序字段">
            <MobileSelect value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {columns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </MobileSelect>
          </LabField>
          <LabField label="排序方向">
            <MobileSelect value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="asc">升序</option>
              <option value="desc">降序</option>
            </MobileSelect>
          </LabField>
          <h3 className="lab-section-heading">显示列</h3>
          {columns.map((column) => (
            <label key={column.key} className="lab-switch-field">
              <span>{column.label}</span>
              <input
                type="checkbox"
                checked={!hiddenColumns.has(column.key)}
                onChange={(event) =>
                  setHiddenColumns((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.delete(column.key);
                    else next.add(column.key);
                    return next;
                  })
                }
              />
            </label>
          ))}
        </LabDialog>
      )}
      {editing && (
        <LabDialog
          title={editing === "new" ? "新建自定义字段" : "编辑自定义字段"}
          onClose={() => setEditing(undefined)}
          onSubmit={async (form) => {
            await store.request(
              editing === "new" ? "field-definitions/" : `field-definitions/${editing.id}/`,
              editing === "new" ? "POST" : "PATCH",
              {
                name: form.get("name"),
                kind,
                options: kind.includes("select")
                  ? String(form.get("options"))
                      .split("\n")
                      .map((v) => v.trim())
                      .filter(Boolean)
                  : [],
                ...(editing === "new" ? {} : { archived: form.get("archived") === "on" }),
              }
            );
            await refresh();
            setEditing(undefined);
          }}
        >
          <LabField label="字段名称">
            <input name="name" maxLength={80} required defaultValue={editing === "new" ? "" : editing.name} />
          </LabField>
          <LabField label="类型">
            <MobileSelect
              value={kind}
              disabled={editing !== "new"}
              onChange={(e) => setKind(e.target.value as LabFieldKind)}
            >
              {Object.entries(names).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </MobileSelect>
          </LabField>
          {kind.includes("select") && (
            <LabField label="选项（每行一项）">
              <textarea name="options" required defaultValue={editing === "new" ? "" : editing.options.join("\n")} />
            </LabField>
          )}
          {editing !== "new" && (
            <label>
              <input type="checkbox" name="archived" defaultChecked={editing.archived} />
              停用字段，保留历史值
            </label>
          )}
        </LabDialog>
      )}
      {selected && (
        <LabDialog
          title={selected.title}
          onClose={() => setSelected(undefined)}
          onSubmit={async (form) => {
            const values: Record<string, unknown> = {};
            for (const field of data.data?.fields ?? []) {
              if (!field.enabled || field.archived) continue;
              const raw = form.get(field.id);
              values[field.id] =
                field.kind === "multi_select"
                  ? form.getAll(field.id)
                  : field.kind === "boolean"
                    ? raw === ""
                      ? null
                      : raw === "true"
                    : field.kind === "number"
                      ? raw === ""
                        ? null
                        : Number(raw)
                      : raw || null;
            }
            await store.request(`tasks/${selected.id}/field-values/`, "PATCH", { values });
            await data.refresh();
            setSelected(undefined);
          }}
        >
          <article className="lab-card">
            <small className="lab-muted">{selected.key}</small>
            <h3>{selected.title}</h3>
            <div className="lab-card-meta">
              <span>{selected.state}</span>
              <span>{selected.project}</span>
              {selected.target_date && <span>{selected.target_date} 截止</span>}
            </div>
          </article>
          {data.data?.fields
            .filter((field) => field.enabled && !field.archived)
            .map((field) => (
              <LabField key={field.id} label={field.name}>
                {field.kind === "single_select" ||
                field.kind === "multi_select" ||
                field.kind === "boolean" ||
                field.kind === "member" ? (
                  <MobileSelect
                    name={field.id}
                    multiple={field.kind === "multi_select"}
                    defaultValue={
                      field.kind === "multi_select"
                        ? (selected.values[field.id] as string[])
                        : String(selected.values[field.id] ?? "")
                    }
                  >
                    <option value="">未设置</option>
                    {(field.kind === "member"
                      ? (
                          project.data?.members ??
                          store.planner?.projects.find((row) => row.id === selected.project_id)?.members ??
                          []
                        ).map((row) => ({ id: row.id, name: row.name }))
                      : field.kind === "boolean"
                        ? [
                            { id: "true", name: "是" },
                            { id: "false", name: "否" },
                          ]
                        : field.options.map((value) => ({ id: value, name: value }))
                    ).map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </MobileSelect>
                ) : (
                  <input
                    name={field.id}
                    type={
                      field.kind === "number"
                        ? "number"
                        : field.kind === "date"
                          ? "date"
                          : field.kind === "url"
                            ? "url"
                            : "text"
                    }
                    step="any"
                    defaultValue={String(selected.values[field.id] ?? "")}
                  />
                )}
              </LabField>
            ))}
        </LabDialog>
      )}
    </>
  );
}
