/** Browser contract fixture; never imported by the release application. */
import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- exercise the actual app theme variables in browser tests
import "../../../styles.css";
import LabFeature from "../index";
import { ApiClient } from "../../../lib/client";
if (new URLSearchParams(location.search).has("dark")) document.documentElement.dataset.theme = "dark";
const requests: { path: string; method: string; body: unknown }[] = [];
const item = {
  id: "i1",
  title: "海试规划",
  description: "确认设备与时段",
  status: "todo",
  kind: "research",
  category_id: "c1",
  category_name: "科研",
  public: false,
  folder_id: null,
  issue_id: null,
  project_name: null,
  issue_key: null,
  priority: null,
  target_date: null,
  schedule: {
    week_minutes: 60,
    future_count: 1,
    total_count: 1,
    next_start: "2026-10-10T01:00:00Z",
    next_end: "2026-10-10T02:00:00Z",
  },
};
const bounty = {
  id: "b1",
  stage_id: "s1",
  project_id: "p1",
  project: "海洋声学",
  issue_id: "t1",
  title: "水听器测试",
  deliverable: "频响记录",
  criteria: "覆盖目标频段",
  budget: "50.00",
  claim_available: "25.00",
  status: "open",
  major: false,
  major_reasons: [],
  evidence: "测试报告",
  due_at: null,
  overdue: false,
  is_lead: true,
  is_reviewer: false,
  is_independent_reviewer: false,
  can_manage_materials: true,
  access_level: "project",
  allocations: [
    {
      id: "a1",
      user_id: "u1",
      name: "测试成员",
      deliverable: "测试记录",
      planned: "25.00",
      awarded: "0.00",
      approved: true,
      confirmed: true,
      closed: false,
    },
  ],
  acceptances: [],
};
const planner = {
  user_id: "u1",
  team_access: true,
  folders: [{ id: "f1", name: "实验", position: 0 }],
  categories: [{ id: "c1", name: "科研", color: "#0f766e", position: 0 }],
  items: [item],
  projects: [
    {
      id: "p1",
      name: "海洋声学",
      lead: true,
      members: [
        { id: "u1", name: "测试成员" },
        { id: "u2", name: "复核员" },
      ],
      states: [{ id: "st1", name: "待做", group: "unstarted" }],
      mapping: { todo: "st1", active: null, review: null, done: null },
    },
  ],
  timezone: "Asia/Shanghai",
  week_start: 1,
  step_minutes: 15,
};
const overview = {
  manager_id: "u1",
  is_manager: true,
  projects: [{ id: "p1", name: "海洋声学", is_lead: true }],
  members: [{ id: "u1", name: "测试成员", is_admin: true }],
  accounts: [
    {
      id: "ac1",
      project_id: "p1",
      stage_id: "s1",
      kind: "execution",
      label: "执行奖励",
      balance: "100.00",
      committed: "40.00",
      available: "60.00",
      can_manage: true,
    },
  ],
  stages: [
    {
      id: "fs1",
      stage_id: "s1",
      project_id: "p1",
      name: "海试",
      B: "50.00",
      E: "100.00",
      purposes: [],
      members: [],
      history: [],
      upgraded: false,
      execution_funded: "100.00",
      history_funded: "0.00",
      can_manage: true,
    },
  ],
  formulas: [],
  forecasts: [],
  batches: [],
  settlements: [
    {
      id: "se1",
      stage_id: "s1",
      user_id: "u1",
      user_name: "测试成员",
      kind: "execution",
      amount: "40.00",
      paid: "0.00",
      outstanding: "40.00",
      committed: "40.00",
      can_manage: true,
    },
  ],
  commitments: [
    {
      id: "co1",
      settlement_id: "se1",
      account_id: "ac1",
      user_id: "u1",
      amount: "40.00",
      paid: "0.00",
      remaining: "40.00",
      cancelled: false,
      can_manage: true,
    },
  ],
  payments: [],
  operations: [],
  entries: [],
};
const viewer = new URLSearchParams(location.search).has("viewer");
if (viewer) {
  planner.team_access = false;
  planner.projects[0]!.lead = false;
  overview.is_manager = false;
  overview.projects[0]!.is_lead = false;
  overview.accounts[0]!.can_manage = false;
}
let failed = false;
class FixtureClient extends ApiClient {
  constructor() {
    super("https://fixtures.invalid");
  }
  override async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    requests.push({ path, method, body });
    const relative = path.replace(/^\/api\/workspaces\/test\/lab\//, "");
    if (method !== "GET") {
      if (relative.endsWith("gantt/preview/"))
        return {
          token: "preview-token",
          changes: [
            {
              id: "t1",
              key: "LAB-1",
              title: "水听器测试",
              old_start_date: "2026-10-10",
              old_target_date: "2026-10-11",
              start_date: "2026-10-12",
              target_date: "2026-10-13",
            },
          ],
        } as T;
      if (
        new URLSearchParams(location.search).has("retry") &&
        !failed &&
        (relative.includes("payment/") || relative.includes("/accept/"))
      ) {
        failed = true;
        throw new Error("测试网络中断，请重试");
      }
      return { id: "new-record", overlap: false } as T;
    }
    const day = "2026-10-10";
    const data: Record<string, unknown> = {
      "planner/": planner,
      "stages/": [{ id: "s1", project_id: "p1", project: "海洋声学", name: "海试", budget: "50.00", reserved: "0.00" }],
      "bounties/": [bounty],
      "inbox/": [],
      "bounties/budgets/": [
        {
          project_id: "p1",
          project: "海洋声学",
          stage_id: "s1",
          stage_name: "海试",
          budget: "50.00",
          reserved: "25.00",
          available: "25.00",
          configured: true,
        },
      ],
      "bounties/b1/detail/": bounty,
      "bounties/b1/workflow/": {
        bounty_id: "b1",
        title: "悬赏流程",
        status: "open",
        current_node: "open",
        nodes: [{ id: "open", label: "认领与验收", state: "current" }],
        edges: [],
        history: [],
        actions: [
          { id: "claim", action: "claim", label: "申请认领", node_id: "open", body: {}, enabled: true, reason: "" },
          { id: "accept", action: "accept", label: "验收", node_id: "open", body: {}, enabled: true, reason: "" },
        ],
      },
      "finance/overview/": overview,
      "projects/p1/gantt/": {
        tasks: [
          {
            id: "t1",
            key: "LAB-1",
            title: "水听器测试",
            start_date: "2026-10-10",
            target_date: "2026-10-11",
            state_group: "unstarted",
          },
        ],
        dependencies: [],
      },
      "field-definitions/": {
        fields: [{ id: "cf1", name: "仪器编号", kind: "text", options: [], archived: false, enabled: true }],
        can_manage: !viewer,
      },
      "task-table/": {
        tasks: [
          {
            id: "t1",
            title: "水听器测试",
            key: "LAB-1",
            project_id: "p1",
            project: "海洋声学",
            state: "待做",
            priority: "medium",
            start_date: null,
            target_date: null,
            editable: !viewer,
            values: { cf1: "HY-001" },
          },
        ],
        fields: [{ id: "cf1", name: "仪器编号", kind: "text", options: [], archived: false, enabled: true }],
      },
      "me/contributions/": {
        timezone: "Asia/Shanghai",
        totals: { earned: "25.00", reversed: "5.00", net: "20.00" },
        projects: [
          {
            id: "p1",
            name: "海洋声学",
            earned: "25.00",
            reversed: "5.00",
            net: "20.00",
            participation: ["project"],
            historical: false,
            can_open_project: true,
          },
        ],
      },
      "me/contributions/calendar/": {
        timezone: "Asia/Shanghai",
        month: "2026-10",
        totals: { earned: "25.00", reversed: "5.00", net: "20.00" },
        days: [
          { day, project_id: "p1", project: "海洋声学", earned: "25.00", reversed: "5.00", net: "20.00", count: 1 },
        ],
      },
      "me/contributions/entries/": {
        timezone: "Asia/Shanghai",
        results: [
          {
            id: "le1",
            created_at: "2026-10-10T01:00:00Z",
            day,
            project_id: "p1",
            project: "海洋声学",
            task_id: "t1",
            task_title: "水听器测试",
            bounty_id: "b1",
            delta: "25.00",
            kind: "award",
            reverses: null,
            archived: false,
            can_open_issue: true,
            can_open_bounty: true,
          },
        ],
        next_cursor: "cursor+1",
      },
      "projects/p1/documents/": {
        documents: [
          {
            id: "doc1",
            name: "实验记录",
            project_id: "p1",
            access: 0,
            owned_by: "u1",
            is_locked: false,
            archived_at: null,
            updated_at: "2026-10-10T01:00:00Z",
          },
        ],
        can_edit: true,
      },
      "documents/doc1/tasks/": {
        tasks: [{ id: "t1", title: "水听器测试", project_id: "p1", key: "LAB-1" }],
        can_edit: true,
      },
      "tasks/": [{ id: "t1", title: "水听器测试", project_id: "p1", project: "海洋声学", key: "LAB-1" }],
    };
    if (relative.startsWith("calendar/"))
      return {
        events: [
          {
            id: "ev1",
            title: "海试规划",
            user_id: "u1",
            start: "2026-10-10T01:00:00Z",
            end: "2026-10-10T02:00:00Z",
            editable: true,
            revision: 7,
            item_id: "i1",
          },
        ],
        members: [{ id: "u1", name: "测试成员" }],
      } as T;
    if (relative.startsWith("bounties/b1/materials/"))
      return { materials: [], sources: { document_versions: [], attachments: [] } } as T;
    if (relative.startsWith("analytics/drilldown/"))
      return {
        chart: "chart1",
        columns: [{ key: "value", label: "任务数" }],
        records: [{ title: "水听器测试", value: 3, url: "/test/projects/p1/issues/t1" }],
      } as T;
    if (relative.startsWith("analytics/"))
      return {
        timezone: "Asia/Shanghai",
        range: { start: day, end: day },
        team: false,
        can_view_team: true,
        projects: [{ id: "p1", name: "海洋声学" }],
        members: [{ id: "u1", name: "测试成员" }],
        charts: [
          {
            id: "chart1",
            domain: "project",
            title: "任务状态",
            kind: "donut",
            unit: "项",
            series: [{ key: "value", label: "任务数" }],
            columns: [{ key: "value", label: "任务数" }],
            rows: [{ id: "todo", label: "待做", value: 3 }],
            note: "按当前状态统计",
          },
        ],
      } as T;
    return (data[relative.split("?")[0]!] ?? []) as T;
  }
}
(window as unknown as { labRequests: typeof requests }).labRequests = requests;
const section = new URLSearchParams(location.search).get("section") ?? "planner";
createRoot(document.getElementById("root")!).render(
  <LabFeature
    section={section}
    workspaceSlug="test"
    client={new FixtureClient()}
    onOpenIssue={() => {}}
    onOpenProject={() => {}}
    onOpenDocument={() => {}}
  />
);
