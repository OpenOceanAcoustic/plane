import { useState } from "react";
import {
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  FileText,
  FolderKanban,
  LineChart,
  Plus,
  Search,
  Settings,
  Wallet,
  Workflow,
} from "lucide-react";
import type { MobileRoute } from "@plane/shared-state/mobile";
import type { ApiClient } from "../lib/client";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Html,
  Loading,
  PageHeading,
  RecordList,
  records,
  textValue,
  useData,
} from "../components/ui";

const links = [
  ["projects", "项目", FolderKanban],
  ["my-tasks", "我的工作", Boxes],
  ["planner", "个人排期", CalendarDays],
  ["team", "团队排期", CalendarDays],
  ["task-table", "任务表", Boxes],
  ["documents", "文档", FileText],
  ["lab-documents", "关联文档", FileText],
  ["bounties", "悬赏与验收", BriefcaseBusiness],
  ["finance", "资金与核准", Wallet],
  ["analytics", "统计", LineChart],
  ["contributions", "我的项目与 VC", LineChart],
  ["workflow", "流程设置", Workflow],
  ["space", "共享页面", BookOpen],
  ["drafts", "草稿", FileText],
  ["workspace-views", "工作区视图", Boxes],
  ["active-cycles", "活跃周期", CalendarDays],
  ["workspace-analytics", "工作区统计", LineChart],
  ["activity", "我的活动", Boxes],
  ["widgets", "首页显示", Settings],
  ["commands", "快捷入口", Boxes],
  ["settings", "设置", Settings],
] as const;
export function Home({
  client,
  workspaceSlug,
  navigate,
}: {
  client: ApiClient;
  workspaceSlug: string;
  navigate: (route: MobileRoute) => void;
}) {
  const path = `/api/workspaces/${workspaceSlug}/stickies/`;
  const stickies = useData(client, path);
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<import("../components/ui").Entity>();
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

  return (
    <>
      <button className="work-entry" onClick={() => navigate({ page: "projects" })}>
        <Boxes />
        <span>工作</span>
        <ChevronRight />
      </button>
      <h2 className="section-label">你的工作</h2>
      <div className="home-links">
        {links.map(([page, title, Icon]) => (
          <button key={page} onClick={() => navigate({ page })}>
            <Icon />
            <span>{title}</span>
            <ChevronRight />
          </button>
        ))}
      </div>
      <ErrorMessage error={preferences.error} />
      {order
        .filter((item) => item.is_enabled)
        .map((widget) => (
          <section key={widget.key}>
            {widget.key === "my_stickies" ? (
              <>
                {" "}
                <div className="section-heading">
                  <h2 className="section-label">便签</h2>
                  <button className="icon-button" aria-label="新增便签" onClick={() => setCreate(true)}>
                    <Plus />
                  </button>
                </div>
                <ErrorMessage error={stickies.error} />
                {stickies.loading ? (
                  <Loading />
                ) : records(stickies.data).length ? (
                  records(stickies.data).map((item) => (
                    <article className="card sticky" key={item.id}>
                      <h3>{textValue(item.name ?? item.title)}</h3>
                      <Html html={item.description_html ?? item.description} />
                      <button className="button" onClick={() => setEditing(item)}>
                        编辑便签
                      </button>
                      <ActionButton
                        action={() => client.request(`${path}${item.id}/`, "DELETE")}
                        onDone={() => {
                          void stickies.refresh();
                        }}
                      >
                        删除便签
                      </ActionButton>
                    </article>
                  ))
                ) : (
                  <div className="sticky-empty">
                    <img src="./assets/sticky-empty.png" alt="" />
                    <p>暂无便签</p>
                    <button className="button" onClick={() => setCreate(true)}>
                      新建便签
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
                        <a
                          className="row"
                          key={link.id}
                          href={String(link.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
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
                              visit.entity_name === "page"
                                ? "document"
                                : visit.entity_name === "project"
                                  ? "tasks"
                                  : "issue",
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
        ))}
      {editing && (
        <FormSheet
          title="编辑便签"
          fields={[
            { key: "name", label: "标题", value: editing.name },
            { key: "description_html", label: "内容", type: "rich", value: editing.description_html },
          ]}
          onClose={() => setEditing(undefined)}
          onSubmit={async (values) => {
            await client.request(`${path}${editing.id}/`, "PATCH", values);
            await stickies.refresh();
          }}
        />
      )}
      {create && (
        <FormSheet
          title="新建便签"
          fields={[
            { key: "name", label: "标题", required: true },
            { key: "description", label: "内容", type: "textarea" },
          ]}
          onClose={() => setCreate(false)}
          onSubmit={async (values) => {
            await client.request(path, "POST", {
              name: values.name,
              description: values.description,
              description_html: `<p>${values.description.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`,
            });
            await stickies.refresh();
          }}
        />
      )}
    </>
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
