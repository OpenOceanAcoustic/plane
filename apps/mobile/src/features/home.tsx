import { useState } from "react";
import { Search } from "lucide-react";
import { CanonicalIcon } from "../components/navigation";
import type { MobileRoute } from "@plane/shared-state/mobile";
import type { ApiClient } from "../lib/client";
import { requestMobileNavigation } from "../lib/mobile-navigation";
import {
  ActionButton,
  ErrorMessage,
  Html,
  Loading,
  PageHeading,
  RecordList,
  records,
  textValue,
  useData,
} from "../components/ui";
import { StickyActions, StickyCard, StickyEditor, stickyRecords, type Sticky } from "./stickies";

export function Home({
  client,
  workspaceSlug,
  navigate,
  userId,
}: {
  client: ApiClient;
  workspaceSlug: string;
  navigate: (route: MobileRoute) => void;
  userId?: string;
}) {
  const path = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/stickies/`;
  const stats = useData<import("../components/ui").Entity>(
    client,
    userId ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/user-stats/${userId}/` : null
  );
  const stickies = useData(client, path);
  const [editing, setEditing] = useState<Sticky | "new">();
  const [actions, setActions] = useState<Sticky>();
  const notes = stickyRecords(stickies.data);
  const openEditor = (note: Sticky) => {
    if (editing !== "new" && editing?.id === note.id) return;
    requestMobileNavigation(() => setEditing(note));
  };
  const openActions = (note: Sticky) =>
    requestMobileNavigation(() => {
      setEditing(undefined);
      setActions(note);
    });
  const preferences = useData<import("./workspace/widgets").HomePreference[]>(
    client,
    `/api/workspaces/${workspaceSlug}/home-preferences/`
  );
  const quickLinks = useData(client, `/api/workspaces/${workspaceSlug}/quick-links/`);
  const recents = useData(client, `/api/workspaces/${workspaceSlug}/recent-visits/`);
  // oxlint-disable-next-line unicorn/no-array-sort -- sort a copy for WebView versions before toSorted
  const order = preferences.data?.length
    ? // oxlint-disable-next-line unicorn/no-array-sort -- sort a copy for older WebViews
      [...preferences.data].sort((a, b) => a.sort_order - b.sort_order)
    : [{ key: "my_stickies", is_enabled: true, sort_order: 0 }];

  const renderWidget = (widget: { key: string }) => (
    <section
      className={
        widget.key === "my_stickies" ? `home-stickies ${notes.length || editing ? "is-populated" : ""}` : "home-widget"
      }
      key={widget.key}
    >
      {widget.key === "my_stickies" ? (
        <>
          <h2 className="section-label">
            <button className="home-stickies-link" onClick={() => navigate({ page: "stickies" })}>
              便签
              <CanonicalIcon name="down" size={13} />
            </button>
          </h2>
          <ErrorMessage error={stickies.error} />
          {stickies.loading ? (
            <Loading />
          ) : notes.length ? (
            <>
              <div className="sticky-list">
                {notes.slice(0, 3).map((note) => (
                  <StickyCard key={note.id} note={note} onEdit={openEditor} onMore={openActions} />
                ))}
              </div>
              <button className="text-button home-stickies-all" onClick={() => navigate({ page: "stickies" })}>
                查看全部便签
              </button>
            </>
          ) : (
            <div className="sticky-empty">
              <img src="./assets/sticky-empty.png" alt="" />
              <p>
                记录灵感，捕捉想法。
                <br />
                添加一张便签，
                <br />
                开始你的工作。
              </p>
              <button className="button" onClick={() => setEditing("new")}>
                创建第一张便签
              </button>
            </div>
          )}
        </>
      ) : widget.key === "quick_links" ? (
        <>
          <h2 className="section-label">快捷链接</h2>
          <ErrorMessage error={quickLinks.error} />
          <div className="list">
            {records(quickLinks.data).map(
              (link) =>
                /^https?:\/\//i.test(String(link.url)) && (
                  <a className="row" key={link.id} href={String(link.url)} target="_blank" rel="noopener noreferrer">
                    {textValue(link.title ?? link.url)}
                  </a>
                )
            )}
          </div>
        </>
      ) : widget.key === "recents" ? (
        <>
          <h2 className="section-label">最近访问</h2>
          <ErrorMessage error={recents.error} />
          <div className="list">
            {records(recents.data).map((visit) => {
              const entity = visit.entity_data as import("../components/ui").Entity | undefined;
              if (!entity) return null;
              const project =
                typeof entity.project === "object" && entity.project
                  ? (entity.project as { id: string }).id
                  : entity.project;
              return (
                <button
                  className="row"
                  key={visit.id}
                  onClick={() =>
                    navigate({
                      page:
                        visit.entity_name === "page" ? "document" : visit.entity_name === "project" ? "tasks" : "issue",
                      projectId: String(
                        visit.entity_name === "project"
                          ? entity.id
                          : (entity.project_id ?? project ?? records(entity.projects)[0]?.id ?? "")
                      ),
                      issueId: entity.id,
                      pageId: entity.id,
                    })
                  }
                >
                  {textValue(entity.name)}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );

  return (
    <div className="home-content">
      <button className="work-entry" onClick={() => navigate({ page: "more" })}>
        <CanonicalIcon name="work" size={24} />
        <strong>工作台</strong>
        <CanonicalIcon name="arrow" size={21} />
      </button>
      <section className="home-work-section">
        <h2 className="section-label">
          我的工作
          <CanonicalIcon name="down" size={13} />
        </h2>
        <button className="home-work-row" onClick={() => navigate({ page: "my-tasks" })}>
          <CanonicalIcon name="workItems" size={23} />
          <span>任务</span>
          <small>{stats.data?.assigned_issues === undefined ? "—" : textValue(stats.data.assigned_issues)}</small>
          <CanonicalIcon name="arrow" size={19} />
        </button>
        <button className="home-work-row" onClick={() => navigate({ page: "documents" })}>
          <CanonicalIcon name="files" size={23} />
          <span>文档</span>
          <small>—</small>
          <CanonicalIcon name="arrow" size={19} />
        </button>
      </section>
      <ErrorMessage error={preferences.error} />
      {order.filter((item) => item.is_enabled && item.key === "my_stickies").map(renderWidget)}
      {editing && (
        <StickyEditor
          key={editing === "new" ? "new" : editing.id}
          note={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(undefined)}
          onSave={async (values) => {
            if (editing === "new") await client.request(path, "POST", values);
            else if (Object.keys(values).length)
              await client.request(`${path}${encodeURIComponent(editing.id)}/`, "PATCH", values);
            // A refresh failure must not offer another POST after the note was saved.
            void stickies.refresh().catch(() => undefined);
          }}
        />
      )}
      <details className="home-secondary-details">
        <summary>
          快捷链接与最近访问
          <CanonicalIcon name="down" size={15} />
        </summary>
        {order.filter((item) => item.is_enabled && item.key !== "my_stickies").map(renderWidget)}
        <button className="button" onClick={() => navigate({ page: "widgets" })}>
          管理首页组件
        </button>
      </details>
      {actions && (
        <StickyActions
          note={actions}
          client={client}
          path={path}
          onClose={() => setActions(undefined)}
          onEdit={openEditor}
          onChanged={stickies.refresh}
        />
      )}
      {!editing && (
        <button className="create-fab" aria-label="新建便签" onClick={() => setEditing("new")}>
          <CanonicalIcon name="plus" size={26} />
        </button>
      )}
    </div>
  );
}
export function Inbox({
  client,
  workspaceSlug,
  navigate,
}: {
  client: ApiClient;
  workspaceSlug: string;
  navigate: (route: MobileRoute) => void;
}) {
  const [tab, setTab] = useState("notifications");
  const [filter, setFilter] = useState("all");
  const [cursor, setCursor] = useState("0:0:0");
  const [error, setError] = useState<unknown>();
  const path = `/api/workspaces/${workspaceSlug}/users/notifications/`;
  const query = new URLSearchParams({ per_page: "30", cursor, archived: String(filter === "archived") });
  if (filter === "unread") query.set("read", "false");
  if (filter === "mentioned") query.set("mentioned", "true");
  const notifications = useData<import("../components/ui").Entity>(
    client,
    tab === "notifications" ? `${path}?${query}` : `/api/workspaces/${workspaceSlug}/lab/inbox/`
  );
  async function open(item: import("../components/ui").Entity) {
    try {
      if (tab === "notifications") {
        await client.request(`${path}${item.id}/read/`, "POST");
        await notifications.refresh();
      }
      const data = (item.data ?? item) as Record<string, unknown>;
      const issueId = data.issue_id ?? item.entity_identifier;
      const projectId = data.project_id ?? item.project;
      if (issueId && projectId) navigate({ page: "issue", projectId: String(projectId), issueId: String(issueId) });
      else if (tab === "lab") navigate({ page: "bounties" });
    } catch (cause) {
      setError(cause);
    }
  }
  return (
    <>
      <PageHeading title="收件箱" />
      <div className="tabs">
        <button className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}>
          通知
        </button>
        <button className={tab === "lab" ? "active" : ""} onClick={() => setTab("lab")}>
          待办核准
        </button>
      </div>
      <ErrorMessage error={notifications.error ?? error} />
      {tab === "notifications" && (
        <label className="field">
          <span>通知筛选</span>
          <select
            aria-label="通知筛选"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setCursor("0:0:0");
            }}
          >
            <option value="all">全部</option>
            <option value="unread">未读</option>
            <option value="mentioned">提及</option>
            <option value="archived">已归档</option>
          </select>
        </label>
      )}
      {tab === "notifications" && (
        <ActionButton
          action={() => client.request(`${path}mark-all-read/`, "POST")}
          onDone={() => {
            void notifications.refresh();
          }}
        >
          全部已读
        </ActionButton>
      )}
      {notifications.loading ? (
        <Loading />
      ) : (
        <div className="list">
          {records(notifications.data).length ? (
            records(notifications.data).map((item) => (
              <article key={item.id} className="card">
                <button className="record-title" onClick={() => void open(item)}>
                  {textValue(item.title ?? item.name)}
                </button>
                <Html html={item.message_html} />
                <p className="muted">{textValue(item.created_at)}</p>
                {tab === "notifications" && (
                  <div className="actions">
                    <ActionButton
                      className="chip"
                      action={async () => {
                        await client.request(`${path}${item.id}/read/`, item.read_at ? "DELETE" : "POST");
                        await notifications.refresh();
                      }}
                    >
                      {item.read_at ? "标记未读" : "标记已读"}
                    </ActionButton>
                    <ActionButton
                      className="chip"
                      action={async () => {
                        await client.request(`${path}${item.id}/archive/`, item.archived_at ? "DELETE" : "POST");
                        await notifications.refresh();
                      }}
                    >
                      {item.archived_at ? "取消归档" : "归档"}
                    </ActionButton>
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="empty">暂无通知</p>
          )}
          {notifications.data?.prev_page_results ? (
            <button className="button" onClick={() => setCursor(String(notifications.data?.prev_cursor))}>
              上一页
            </button>
          ) : null}
          {notifications.data?.next_page_results ? (
            <button className="button" onClick={() => setCursor(String(notifications.data?.next_cursor))}>
              下一页
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}
export function SearchPage({
  client,
  workspaceSlug,
  navigate,
}: {
  client: ApiClient;
  workspaceSlug: string;
  navigate: (route: MobileRoute) => void;
}) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const found = useData(
    client,
    term ? `/api/workspaces/${workspaceSlug}/search/?search=${encodeURIComponent(term)}` : null
  );
  return (
    <>
      <PageHeading title="搜索" />
      <form
        className="search-field"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(query);
        }}
      >
        <Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索项目、工作项、文档"
          aria-label="搜索内容"
        />
        <button type="submit" className="text-button">
          搜索
        </button>
      </form>
      <ErrorMessage error={found.error} />
      {found.loading ? (
        <Loading />
      ) : (
        found.data && (
          <>
            {Object.entries(
              (found.data as { results?: Record<string, unknown> }).results ?? (found.data as Record<string, unknown>)
            ).map(([kind, rows]) => (
              <section key={kind}>
                <h2 className="section-label">{kind}</h2>
                <RecordList
                  data={rows}
                  fields={["identifier", "project", "name"]}
                  onOpen={(item) => {
                    const project =
                      item.project && typeof item.project === "object"
                        ? (item.project as Record<string, unknown>).id
                        : item.project;
                    const projectId = String(item.project_id ?? project ?? (kind.includes("project") ? item.id : ""));
                    navigate({
                      page: kind.includes("page") ? "document" : kind.includes("project") ? "tasks" : "issue",
                      projectId,
                      issueId: item.id,
                      pageId: item.id,
                    });
                  }}
                />
              </section>
            ))}
          </>
        )
      )}
    </>
  );
}
