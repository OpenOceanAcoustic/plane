import { useEffect, useRef } from "react";
import { ErrorMessage, Loading, useData, type Entity } from "../../components/ui";
import { Button } from "../lab/ui";
import { groupNames, priorityName } from "../core/model";
import { workspacePath, type Page, type WorkspaceProps } from "./business";
export const widgetNames: Record<string, string> = {
  quick_links: "快捷链接",
  recents: "最近访问",
  my_stickies: "我的便签",
  new_at_plane: "新功能",
  quick_tutorial: "快速教程",
};
export function useWorkspace(props: WorkspaceProps) {
  const base = workspacePath(props.workspaceSlug);
  const membership = useData<Entity>(props.client, `${base}/workspace-members/me/`);
  const session = useData<{ user: { id: string } }>(props.client, "/api/lab/session/");
  const projects = useData<Entity[]>(props.client, `${base}/projects/`);
  return { base, membership, session, projects, role: Number(membership.data?.role ?? 0) };
}
export function Status({ loading, error, empty }: { loading?: boolean; error?: unknown; empty?: boolean }) {
  return (
    <>
      {loading && <Loading />}
      <ErrorMessage error={error} />
      {!loading && !error && empty && <p className="empty">暂无记录</p>}
    </>
  );
}
export function Pagination({
  page,
  onChange,
}: {
  page: Page<unknown> | undefined;
  onChange: (cursor: string) => void;
}) {
  return (
    <div className="lab-actions">
      {page?.prev_page_results && page.prev_cursor && (
        <Button onClick={() => onChange(page.prev_cursor!)}>上一页</Button>
      )}
      {page?.next_page_results && page.next_cursor && (
        <Button onClick={() => onChange(page.next_cursor!)}>下一页</Button>
      )}
    </div>
  );
}
export function TaskRows({ rows, onNavigate }: { rows: Entity[]; onNavigate: WorkspaceProps["onNavigate"] }) {
  return (
    <div className="lab-list">
      {rows.map((row) => (
        <article className="lab-card" key={String(row.id)}>
          <button
            className="record-title"
            onClick={() =>
              onNavigate({ page: "issue", projectId: String(row.project_id ?? row.project), issueId: String(row.id) })
            }
          >
            {String(row.name ?? "任务")}
          </button>
          <p className="lab-muted">
            {priorityName(row.priority)} · {groupNames[String(row["state__group"])] ?? ""}
          </p>
          {!!row.target_date && <p>截止 {String(row.target_date).slice(0, 10)}</p>}
        </article>
      ))}
    </div>
  );
}
export function useDetailBack(selected: boolean, onClose: () => void) {
  const callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    if (!selected) return;
    const back = (event: Event) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      callback.current();
    };
    window.addEventListener("mobileBack", back, true);
    return () => window.removeEventListener("mobileBack", back, true);
  }, [selected]);
}
