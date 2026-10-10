import { useState, type ReactNode } from "react";
import { Check, Plus, Search } from "lucide-react";
import { ErrorMessage, Loading, Sheet, records, useData, type Entity } from "../../components/ui";
import type { ApiClient } from "../../lib/client";
import type { CoreProps, NamedEntity } from "./model";

export function ResultState({ error, loading, children }: { error: unknown; loading: boolean; children: ReactNode }) {
  return (
    <>
      <ErrorMessage error={error} />
      {loading ? <Loading /> : children}
    </>
  );
}
export function DetailFields({ values }: { values: [string, ReactNode][] }) {
  return (
    <dl className="record-fields">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "未设置"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Empty({ children = "暂无记录" }: { children?: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="button primary" onClick={onClick}>
      <Plus size={17} />
      {children}
    </button>
  );
}
export function ProjectPicker({ client, workspaceSlug, section, onNavigate }: CoreProps) {
  const { data, error, loading } = useData<NamedEntity[]>(
    client,
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/projects/`
  );
  return (
    <ResultState error={error} loading={loading}>
      <div className="list">
        {records(data).map((project) => (
          <button
            key={project.id}
            className="card core-project-picker"
            onClick={() => onNavigate({ page: section, projectId: String(project.id) })}
          >
            <span className="core-project-icon">{String(project.identifier ?? project.name ?? "P").slice(0, 2)}</span>
            <strong>{project.name}</strong>
            <span className="muted">选择项目 ›</span>
          </button>
        ))}
        {!records(data).length && <Empty>暂无项目</Empty>}
      </div>
    </ResultState>
  );
}
export function MultiSelectSheet({
  title,
  options,
  selected,
  onSave,
  onClose,
}: {
  title: string;
  options: { id: string; name: string }[];
  selected: string[];
  onSave: (ids: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(selected);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Sheet title={title} onClose={onClose}>
      <label className="core-search">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" />
      </label>
      <div className="list core-options">
        {options
          .filter((row) => row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((row) => (
            <button
              type="button"
              className="row core-option"
              aria-pressed={ids.includes(row.id)}
              key={row.id}
              onClick={() => setIds(ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id])}
            >
              <span>{row.name}</span>
              {ids.includes(row.id) && <Check size={20} />}
            </button>
          ))}
      </div>
      <ErrorMessage error={error} />
      <button
        className="button primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await onSave(ids);
            onClose();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "保存中…" : "保存"}
      </button>
    </Sheet>
  );
}
export function TaskSearchSheet({
  client,
  workspaceSlug,
  projectId,
  title = "选择任务",
  exclude = [],
  onSelect,
  onClose,
}: {
  client: ApiClient;
  workspaceSlug: string;
  projectId?: string;
  title?: string;
  exclude?: string[];
  onSelect: (issue: Entity) => Promise<unknown>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState<unknown>();
  const params = new URLSearchParams({ q: query });
  if (projectId) params.set("project_id", projectId);
  const { data, loading, error } = useData(
    client,
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/lab/tasks/?${params}`
  );
  const tasks = records(data).filter((task) => !exclude.includes(String(task.id)));
  return (
    <Sheet title={title} onClose={onClose}>
      <label className="core-search">
        <Search size={18} />
        <input placeholder="任务名称" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <ErrorMessage error={actionError} />
      <ResultState loading={loading} error={error}>
        <div className="list">
          {tasks.map((task) => (
            <button
              disabled={busy}
              className="card core-select-task"
              key={task.id}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  await onSelect(task);
                  onClose();
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span className="muted">{String(task.key ?? "")}</span>
              <strong>{String(task.title ?? task.name ?? "任务")}</strong>
              <span className="muted">{String(task.project ?? "")}</span>
            </button>
          ))}
          {!tasks.length && <Empty>未找到任务</Empty>}
        </div>
      </ResultState>
    </Sheet>
  );
}
