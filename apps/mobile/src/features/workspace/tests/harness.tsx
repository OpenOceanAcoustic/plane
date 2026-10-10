/** Public UI/HTTP contract fixtures, never imported by release code. */
import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- verify the actual mobile theme
import "../../../styles.css";
import WorkspaceFeature from "../index";
import { ApiClient } from "../../../lib/client";
const requests: { path: string; method: string; body: unknown }[] = [];
const draft = {
  id: "d1",
  name: "准备海试",
  description_html: "<p>完整描述</p>",
  project_id: "p1",
  priority: "high",
  state_id: "st1",
  assignee_ids: ["u1"],
  label_ids: ["l1"],
  cycle_id: "c1",
  module_ids: ["m1"],
  parent_id: null,
};
const view = {
  id: "v1",
  name: "海试进度",
  description: "进行中的任务",
  owned_by: "u1",
  access: 1,
  is_locked: false,
  filters: { project: ["p1"], state_group: ["started"], priority: ["high"] },
};
const task = { id: "t1", name: "采样试验", project_id: "p1", priority: "high", state__group: "started" };
const preferences = [
  { key: "quick_links", is_enabled: true, sort_order: 10 },
  { key: "recents", is_enabled: true, sort_order: 20 },
  { key: "my_stickies", is_enabled: false, sort_order: 30 },
];
class FixtureClient extends ApiClient {
  constructor() {
    super("https://workspace-fixtures.invalid");
  }
  override async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    requests.push({ path, method, body });
    const url = new URL(path, "https://fixture.invalid"),
      suffix = url.pathname.replace("/api/workspaces/test/", "");
    let response: unknown = [];
    if (path === "/api/lab/session/") response = { user: { id: "u1" } };
    else if (suffix === "workspace-members/me/")
      response = { role: new URLSearchParams(location.search).has("guest") ? 5 : 20 };
    else if (suffix === "projects/")
      response = [
        { id: "p1", name: "海洋声学" },
        { id: "p2", name: "信号处理" },
      ];
    else if (suffix === "members/" || suffix === "projects/p1/members/")
      response = [{ member: { id: "u1", display_name: "测试成员" }, role: 20, is_active: true }];
    else if (suffix === "projects/p1/states/") response = [{ id: "st1", name: "进行中" }];
    else if (suffix === "projects/p1/issue-labels/") response = [{ id: "l1", name: "海试" }];
    else if (suffix === "projects/p1/modules/") response = [{ id: "m1", name: "实验" }];
    else if (suffix === "projects/p1/cycles/") response = [{ id: "c1", name: "十月试验" }];
    else if (suffix === "projects/p1/search-issues/") response = [task];
    else if (suffix === "home-preferences/") response = preferences;
    else if (suffix.startsWith("home-preferences/")) {
      const entry = preferences.find((row) => suffix.includes(row.key));
      if (entry && body) Object.assign(entry, body);
      response = entry;
    } else if (suffix === "draft-issues/") {
      if (method === "POST") response = { ...draft, ...(body as object), id: "d2" };
      else response = { results: [draft] };
    } else if (suffix === "draft-issues/d1/") response = draft;
    else if (suffix === "draft-to-issue/d1/") response = task;
    else if (suffix === "views/") response = method === "GET" ? [view] : { ...view, ...(body as object) };
    else if (suffix === "views/v1/") response = method === "PATCH" ? Object.assign(view, body) : view;
    else if (suffix === "issues/")
      response = { results: [task], next_page_results: !url.searchParams.has("cursor"), next_cursor: "next+1" };
    else if (suffix.startsWith("user-activity/"))
      response = {
        results: [
          {
            id: "a1",
            created_at: "2026-10-10T01:00:00Z",
            verb: "updated",
            field: "priority",
            old_value: "low",
            new_value: "high",
            issue_detail: task,
            project: "p1",
            project_detail: { id: "p1", name: "海洋声学" },
          },
        ],
        next_page_results: true,
        next_cursor: "activity+1",
      };
    else if (suffix === "cycles/")
      response = [
        {
          id: "c1",
          project_id: "p1",
          name: "十月试验",
          status: "active",
          start_date: "2026-10-01",
          end_date: "2026-10-31",
          total_issues: 4,
          completed_issues: 1,
          started_issues: 2,
        },
        { id: "c2", project_id: "p1", name: "后续周期", start_date: "2099-01-01", end_date: "2099-01-31" },
      ];
    else if (suffix === "projects/p1/cycles/c1/cycle-issues/") response = { results: [task] };
    else if (suffix === "advance-analytics/")
      response = { total_work_items: { count: 4 }, completed_work_items: { count: 1 } };
    else if (suffix === "advance-analytics-stats/")
      response = [{ project_id: "p1", project__name: "海洋声学", started_work_items: 3, completed_work_items: 1 }];
    else if (suffix === "advance-analytics-charts/")
      response =
        url.searchParams.get("type") === "projects"
          ? [{ key: "work_items", name: "Work Items", count: 4 }]
          : url.searchParams.get("type") === "work-items"
            ? {
                data: [
                  { key: "2026-09-01", name: "2026-09-01", count: 3, created_issues: 3, completed_issues: 1 },
                  { key: "2026-10-01", name: "2026-10-01", count: 4, created_issues: 4, completed_issues: 2 },
                ],
                schema: { created_issues: "created_issues", completed_issues: "completed_issues" },
              }
            : { data: [{ key: "high", name: "high", count: 4 }], schema: {} };
    else if (suffix === "quick-links/")
      response =
        method === "GET"
          ? [{ id: "q1", title: "资料站", url: "https://example.org/" }]
          : { id: "q2", ...(body as object) };
    else if (suffix === "quick-links/q1/") response = {};
    return response as T;
  }
}
Object.assign(window, { workspaceRequests: requests });
createRoot(document.getElementById("root")!).render(
  <WorkspaceFeature
    client={new FixtureClient()}
    workspaceSlug="test"
    section={new URLSearchParams(location.search).get("section") ?? "widgets"}
    onNavigate={(route) => {
      requests.push({ path: "navigate", method: "NAV", body: route });
    }}
  />
);
