/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState, useEffect } from "react";
import type { LabCustomField, LabTaskTableData, LabTaskRow, LabFieldKind, LabMember } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { LabDialog, LabField, Button, Empty, ErrorMessage, KeyValues } from "./ui";
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
  useEffect(() => {
    setSelected(undefined);
    setEditing(undefined);
  }, [projectId]);
  const refresh = async () => {
    await Promise.all([data.refresh(), definitions.refresh(), ...(projectId ? [project.refresh()] : [])]);
  };
  return (
    <>
      <div className="lab-heading">
        <h3>任务字段与记录</h3>
        <Button onClick={() => void refresh().catch(() => {})}>刷新</Button>
      </div>
      <ErrorMessage error={data.error || definitions.error || project.error} />
      <input
        className="lab-input"
        aria-label="搜索任务记录"
        placeholder="搜索任务"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <details>
        <summary>自定义字段管理</summary>
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
                <label>
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
                  在当前项目启用
                </label>
              )}
            </div>
          </article>
        ))}
      </details>
      {data.data?.tasks
        .filter((row) => `${row.title} ${row.key}`.toLowerCase().includes(query.toLowerCase()))
        .map((row) => (
          <article key={row.id} className="lab-card">
            <h3>
              {row.key} · {row.title}
            </h3>
            <p className="lab-muted">
              {row.project} · {row.state}
            </p>
            <KeyValues
              values={{
                优先级: row.priority,
                开始: row.start_date,
                截止: row.target_date,
                ...Object.fromEntries(
                  (data.data?.fields ?? []).map((field) => [
                    field.name,
                    typeof row.values[field.id] === "boolean"
                      ? row.values[field.id]
                        ? "是"
                        : "否"
                      : row.values[field.id],
                  ])
                ),
              }}
            />
            <div className="lab-actions">
              {row.editable && <Button onClick={() => setSelected(row)}>填写字段</Button>}
              {onOpenIssue && <Button onClick={() => onOpenIssue(row.project_id, row.id)}>任务详情</Button>}
            </div>
          </article>
        ))}
      {data.data && !data.data.tasks.length && <Empty />}
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
            <select value={kind} disabled={editing !== "new"} onChange={(e) => setKind(e.target.value as LabFieldKind)}>
              {Object.entries(names).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
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
          {data.data?.fields
            .filter((field) => field.enabled && !field.archived)
            .map((field) => (
              <LabField key={field.id} label={field.name}>
                {field.kind === "single_select" ||
                field.kind === "multi_select" ||
                field.kind === "boolean" ||
                field.kind === "member" ? (
                  <select
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
                  </select>
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
