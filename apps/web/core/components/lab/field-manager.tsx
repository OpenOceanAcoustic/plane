/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";
import type { LabCustomField, LabFieldKind, LabFieldValue } from "./fields-types";
import { fieldKindNames } from "./fields-types";

type Member = { id: string; name: string };
export function LabFieldEditor({
  field,
  value,
  members = [],
  disabled = false,
  save,
}: {
  field: LabCustomField;
  value: LabFieldValue | undefined;
  members?: Member[];
  disabled?: boolean;
  save: (value: LabFieldValue) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(value);
  }, [value]);
  async function submit(next: LabFieldValue) {
    setDraft(next);
    setPending(true);
    setError("");
    try {
      await save(next);
    } catch (err) {
      setDraft(value);
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  const inactive = disabled || pending || field.archived || !field.enabled;
  let input;
  if (["single_select", "member", "boolean"].includes(field.kind)) {
    const options =
      field.kind === "member"
        ? members.map((m) => [m.id, m.name])
        : field.kind === "boolean"
          ? [
              ["true", "是"],
              ["false", "否"],
            ]
          : field.options.map((v) => [v, v]);
    input = (
      <select
        aria-label={field.name}
        className={labInputClass}
        disabled={inactive}
        value={draft == null ? "" : String(draft)}
        onChange={(event) =>
          void submit(
            event.target.value === ""
              ? null
              : field.kind === "boolean"
                ? event.target.value === "true"
                : event.target.value
          )
        }
      >
        <option value="">未填写</option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
        {field.kind === "member" && typeof draft === "string" && !members.some((m) => m.id === draft) && (
          <option value={draft}>已离开项目的成员</option>
        )}
      </select>
    );
  } else if (field.kind === "multi_select") {
    const selected = Array.isArray(draft) ? draft : [];
    input = (
      <div className="flex flex-wrap gap-2">
        {field.options.map((option) => (
          <label key={option} className="flex items-center gap-1 text-12">
            <input
              type="checkbox"
              disabled={inactive}
              checked={selected.includes(option)}
              onChange={(event) =>
                void submit(event.target.checked ? [...selected, option] : selected.filter((v) => v !== option))
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  } else {
    input = (
      <input
        aria-label={field.name}
        className={labInputClass}
        disabled={inactive}
        type={
          field.kind === "number" ? "number" : field.kind === "date" ? "date" : field.kind === "url" ? "url" : "text"
        }
        step={field.kind === "number" ? "any" : undefined}
        value={draft == null ? "" : String(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (String(draft ?? "") !== String(value ?? ""))
            void submit(draft === "" ? null : field.kind === "number" ? Number(draft) : (draft ?? null));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(value);
        }}
      />
    );
  }
  return (
    <div>
      {input}
      {error && (
        <p role="alert" className="text-red-500 mt-1 text-12">
          {error}
        </p>
      )}
    </div>
  );
}

export const LabFieldManager = observer(function LabFieldManager({
  store,
  projectId,
  changed,
}: {
  store: LabStore;
  projectId: string;
  changed: () => void;
}) {
  const [fields, setFields] = useState<LabCustomField[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [lead, setLead] = useState(false);
  const [editing, setEditing] = useState<LabCustomField | "new">();
  const [kind, setKind] = useState<LabFieldKind>("text");
  const [loaded, setLoaded] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const loadSerial = useRef(0);
  const projectContext = useMemo(() => ({ store, projectId }), [store, projectId]);
  const currentContext = useRef(projectContext);
  currentContext.current = projectContext;
  const load = useCallback(async () => {
    const serial = ++loadSerial.current;
    setLoaded(false);
    setLead(false);
    setTogglePending(false);
    try {
      const [definitions, project] = await Promise.all([
        store.request<{ fields: LabCustomField[]; can_manage: boolean }>("field-definitions/"),
        projectId
          ? store.request<{ fields: LabCustomField[]; can_manage: boolean }>(`projects/${projectId}/fields/`)
          : Promise.resolve(null),
      ]);
      if (serial !== loadSerial.current || projectContext !== currentContext.current) return;
      setFields(definitions.fields);
      setAdmin(definitions.can_manage);
      setEnabled(project?.fields.filter((field) => field.enabled && !field.archived).map((field) => field.id) ?? []);
      setLead(project?.can_manage ?? false);
      setLoaded(true);
    } catch (error) {
      if (serial === loadSerial.current && projectContext === currentContext.current) throw error;
    }
  }, [store, projectId, projectContext]);
  useEffect(() => {
    void store.execute(load);
    return () => {
      loadSerial.current += 1;
    };
  }, [store, load]);
  function toggleField(fieldId: string, checked: boolean) {
    const serial = loadSerial.current;
    const context = projectContext;
    const previous = enabled;
    const ids = checked ? [...enabled, fieldId] : enabled.filter((id) => id !== fieldId);
    const current = () => serial === loadSerial.current && context === currentContext.current;
    // A controlled checkbox must reflect the user's click before a slow request completes.
    setEnabled(ids);
    setTogglePending(true);
    void store.execute(async () => {
      try {
        await store.request(`projects/${projectId}/fields/`, "PUT", { ids });
        if (current()) changed();
      } catch (error) {
        if (!current()) return;
        setEnabled(previous);
        throw error;
      } finally {
        if (current()) setTogglePending(false);
      }
    });
  }
  return (
    <section className="rounded-lg border border-subtle bg-surface-1 p-4">
      <header className="mb-3 flex items-center gap-3">
        <h2 className="mr-auto text-14 font-semibold">自定义字段</h2>
        {admin && (
          <Button
            size="sm"
            onClick={() => {
              setKind("text");
              setEditing("new");
            }}
          >
            新建字段
          </Button>
        )}
      </header>
      {!projectId && <p className="mb-3 text-12 text-secondary">选择项目后，可由项目负责人配置启用的字段。</p>}
      {loaded && !fields.length && <p className="text-13 text-secondary">尚未定义字段</p>}
      <div className="flex flex-wrap gap-2">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center gap-2 rounded-md border border-subtle px-3 py-2 text-13">
            {lead && !field.archived && (
              <input
                aria-label={`启用 ${field.name}`}
                type="checkbox"
                checked={enabled.includes(field.id)}
                disabled={store.busy || togglePending}
                onChange={(event) => toggleField(field.id, event.target.checked)}
              />
            )}
            <span className={field.archived ? "text-tertiary" : ""}>{field.name}</span>
            <span className="text-11 text-tertiary">
              {fieldKindNames[field.kind]}
              {field.archived ? " · 已停用" : ""}
            </span>
            {admin && (
              <button
                className="text-accent-primary"
                onClick={() => {
                  setKind(field.kind);
                  setEditing(field);
                }}
              >
                编辑
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <LabDialog
          title={editing === "new" ? "新建自定义字段" : "编辑自定义字段"}
          busy={store.busy}
          onClose={() => setEditing(undefined)}
          onSubmit={async (form) => {
            await store.execute(async () => {
              const options = String(form.get("options") ?? "")
                .split("\n")
                .map((v) => v.trim())
                .filter(Boolean);
              await store.request(
                editing === "new" ? "field-definitions/" : `field-definitions/${editing.id}/`,
                editing === "new" ? "POST" : "PATCH",
                {
                  name: form.get("name"),
                  kind,
                  options: kind.includes("select") ? options : [],
                  ...(editing === "new" ? {} : { archived: form.get("archived") === "on" }),
                }
              );
              await load();
              changed();
              setEditing(undefined);
            });
          }}
        >
          <LabField label="字段名称">
            <input
              name="name"
              className={labInputClass}
              required
              maxLength={80}
              defaultValue={editing === "new" ? "" : editing.name}
            />
          </LabField>
          <LabField label="类型">
            <select
              className={labInputClass}
              value={kind}
              disabled={editing !== "new"}
              onChange={(event) => setKind(event.target.value as LabFieldKind)}
            >
              {Object.entries(fieldKindNames).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </LabField>
          {kind.includes("select") && (
            <LabField label="选项（每行一个）">
              <textarea
                name="options"
                className={labInputClass}
                rows={5}
                required
                defaultValue={editing === "new" ? "" : editing.options.join("\n")}
              />
            </LabField>
          )}
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-13">
              <input name="archived" type="checkbox" defaultChecked={editing.archived} />
              停用字段，保留历史值
            </label>
          )}
          {store.error && (
            <p role="alert" className="text-red-500 text-13">
              {store.error}
            </p>
          )}
        </LabDialog>
      )}
    </section>
  );
});

export function LabIssueFields({
  workspaceSlug,
  projectId,
  issueId,
  editable = false,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  editable?: boolean;
}) {
  const store = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const [fields, setFields] = useState<LabCustomField[]>([]);
  const [values, setValues] = useState<Record<string, LabFieldValue>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      store.request<{ fields: LabCustomField[]; values: Record<string, LabFieldValue> }>(
        `tasks/${issueId}/field-values/`
      ),
      store.request<{ members: Member[] }>(`projects/${projectId}/fields/`),
    ])
      .then(([data, project]) => {
        if (!cancelled) {
          setFields(data.fields);
          setValues(data.values);
          setMembers(project.members);
          setError("");
        }
        return data;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "读取字段失败");
      });
    return () => {
      cancelled = true;
    };
  }, [store, projectId, issueId]);
  if (error)
    return (
      <p role="alert" className="text-red-500 text-12">
        {error}
      </p>
    );
  if (!fields.length) return null;
  return (
    <section className="rounded-lg border border-subtle p-4">
      <h3 className="mb-3 text-14 font-semibold">自定义字段</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <LabField key={field.id} label={`${field.name}${field.archived || !field.enabled ? "（已停用）" : ""}`}>
            <LabFieldEditor
              field={field}
              value={values[field.id]}
              members={members}
              disabled={!editable}
              save={async (value) => {
                const result = await store.request<{ values: Record<string, LabFieldValue> }>(
                  `tasks/${issueId}/field-values/`,
                  "PATCH",
                  { values: { [field.id]: value } }
                );
                setValues(result.values);
              }}
            />
          </LabField>
        ))}
      </div>
    </section>
  );
}
