import type { MobileRoute, MobileUser } from "@plane/shared-state/mobile";
import { CanonicalIcon, type CanonicalIconName } from "../components/navigation";
import { ActionButton, ErrorMessage, PageHeading, useData, type Entity } from "../components/ui";
import type { ApiClient } from "../lib/client";
import { roleName } from "./settings/api";

type Link = { page: string; label: string; icon: CanonicalIconName; value?: string };
const groups: { title: string; links: Link[] }[] = [
  {
    title: "应用",
    links: [
      { page: "planner", label: "个人规划", icon: "calendar" },
      { page: "projects", label: "项目", icon: "folder" },
      { page: "bounties", label: "悬赏大厅", icon: "market" },
    ],
  },
  {
    title: "实验室",
    links: [
      { page: "team", label: "团队排期", icon: "calendar" },
      { page: "task-table", label: "任务表格", icon: "task" },
      { page: "finance", label: "资金与奖励", icon: "wallet" },
      { page: "analytics", label: "数据总览", icon: "analytics" },
      { page: "contributions", label: "我的项目与 VC", icon: "diamond" },
    ],
  },
  {
    title: "工作与设置",
    links: [
      { page: "workspace-settings", label: "工作区", icon: "folder" },
      { page: "settings", label: "个人设置", icon: "user" },
      { page: "project-settings", label: "项目设置", icon: "settings" },
      { page: "space", label: "共享项目", icon: "globe", value: "Space" },
    ],
  },
];
const additional: Link[] = [
  { page: "lab-documents", label: "关联文档", icon: "doc" },
  { page: "drafts", label: "草稿", icon: "note" },
  { page: "workspace-views", label: "工作区视图", icon: "grid" },
  { page: "active-cycles", label: "活跃周期", icon: "calendar" },
  { page: "workspace-analytics", label: "工作区统计", icon: "analytics" },
  { page: "activity", label: "我的活动", icon: "activity" },
  { page: "widgets", label: "首页显示", icon: "settings" },
  { page: "commands", label: "快捷入口", icon: "grid" },
  { page: "workflow", label: "流程设置", icon: "layers" },
];

export default function More({
  client,
  workspaceSlug,
  workspaceName,
  user,
  navigate,
  onLogout,
}: {
  client: ApiClient;
  workspaceSlug: string;
  workspaceName: string;
  user: MobileUser;
  navigate: (route: MobileRoute) => void;
  onLogout: () => Promise<void>;
}) {
  const membership = useData<Entity>(
    client,
    workspaceSlug ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/workspace-members/me/` : null
  );
  const displayName = user.display_name || user.username;
  const rows = (links: Link[]) => (
    <div className="pm-settings-list">
      {links.map((link) => (
        <button className="pm-list-row" key={link.page} onClick={() => navigate({ page: link.page })}>
          <span className="pm-list-symbol">
            <CanonicalIcon name={link.icon} size={20} />
          </span>
          <span className="pm-list-label">{link.label}</span>
          {link.value && <span className="pm-list-value">{link.value}</span>}
          <CanonicalIcon name="chevron" size={16} />
        </button>
      ))}
    </div>
  );
  return (
    <>
      <PageHeading title="工作台" />
      <main className="pm-body pm-workbench">
        <button className="pm-account" onClick={() => navigate({ page: "settings" })}>
          <span className="pm-avatar">{displayName.slice(0, 1)}</span>
          <span className="pm-account-copy">
            <strong>
              {displayName}
              <span className="pm-member">
                {membership.data?.role !== undefined ? roleName(membership.data.role) : ""}
              </span>
            </strong>
            <span>{workspaceName}</span>
            <small>{user.username}</small>
          </span>
          <CanonicalIcon name="chevron" size={18} />
        </button>
        {groups.slice(0, 2).map((group) => (
          <section className="pm-launcher-section" key={group.title}>
            <h2>{group.title}</h2>
            <div className="pm-launcher">
              {group.links.map((link) => (
                <button
                  className="pm-app"
                  key={link.page}
                  aria-label={link.label}
                  onClick={() => navigate({ page: link.page })}
                >
                  <span className="pm-app-symbol">
                    <CanonicalIcon name={link.icon} size={25} />
                  </span>
                  <span>{link.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <section className="pm-settings-section">
          <h2>工作与设置</h2>
          {rows(groups[2].links)}
        </section>
        <details className="pm-more-work">
          <summary>
            更多工作
            <CanonicalIcon name="down" size={18} />
          </summary>
          {rows(additional)}
        </details>
        <ErrorMessage error={membership.error} />
        <ActionButton className="pm-logout" action={onLogout}>
          <CanonicalIcon name="logout" size={18} />
          退出登录
        </ActionButton>
      </main>
    </>
  );
}
