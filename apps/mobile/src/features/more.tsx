import type { MobileRoute, MobileUser } from "@plane/shared-state/mobile";
import { CanonicalIcon, type CanonicalIconName } from "../components/navigation";
import { ActionButton, ErrorMessage, useData, type Entity } from "../components/ui";
import type { ApiClient } from "../lib/client";
import { roleName } from "./settings/api";

type Link = { page: string; label: string; icon: CanonicalIconName; value?: string };
const groups: { title: string; links: Link[] }[] = [
  {
    title: "应用",
    links: [
      { page: "planner", label: "个人规划", icon: "plan" },
      { page: "projects", label: "项目", icon: "projects" },
      { page: "bounties", label: "悬赏大厅", icon: "market" },
    ],
  },
  {
    title: "实验室",
    links: [
      { page: "team", label: "团队排期", icon: "plan" },
      { page: "task-table", label: "任务表格", icon: "projects" },
      { page: "finance", label: "资金与奖励", icon: "finance" },
      { page: "analytics", label: "数据总览", icon: "analytics" },
      { page: "contributions", label: "我的项目与 VC", icon: "analytics" },
    ],
  },
  {
    title: "工作与设置",
    links: [
      { page: "workspace-settings", label: "工作区", icon: "projects" },
      { page: "settings", label: "个人设置", icon: "users" },
      { page: "project-settings", label: "项目设置", icon: "settings" },
      { page: "space", label: "共享项目", icon: "projects", value: "Space" },
    ],
  },
];
const additional: Link[] = [
  { page: "stickies", label: "便签", icon: "files" },
  { page: "lab-documents", label: "关联文档", icon: "files" },
  { page: "drafts", label: "草稿", icon: "files" },
  { page: "workspace-views", label: "工作区视图", icon: "projects" },
  { page: "active-cycles", label: "活跃周期", icon: "plan" },
  { page: "workspace-analytics", label: "工作区统计", icon: "analytics" },
  { page: "activity", label: "我的活动", icon: "workItems" },
  { page: "widgets", label: "首页显示", icon: "settings" },
  { page: "commands", label: "快捷入口", icon: "apps" },
  { page: "workflow", label: "流程设置", icon: "settings" },
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
    <div className="more-rows">
      {links.map((link) => (
        <button className="row" key={link.page} onClick={() => navigate({ page: link.page })}>
          <span className="row-icon">
            <CanonicalIcon name={link.icon} />
          </span>
          <span className="row-main">
            <strong>{link.label}</strong>
          </span>
          {link.value && <span className="row-value">{link.value}</span>}
          <CanonicalIcon name="arrow" size={16} />
        </button>
      ))}
    </div>
  );
  return (
    <div className="more-content">
      <button className="person-card card" onClick={() => navigate({ page: "settings" })}>
        <span className="profile-avatar">{displayName.slice(0, 1)}</span>
        <div className="card-body">
          <h3>{displayName}</h3>
          <p className="secondary">{workspaceName}</p>
          <div className="card-meta">
            {membership.data?.role !== undefined && (
              <span>
                <CanonicalIcon name="users" size={14} />
                {roleName(membership.data.role)}
              </span>
            )}
            <span>
              <CanonicalIcon name="tag" size={14} />
              {user.username}
            </span>
          </div>
        </div>
      </button>
      {groups.map((group) => (
        <section className="more-group" key={group.title}>
          <div className="section-heading">
            <h2>{group.title}</h2>
          </div>
          {rows(group.links)}
        </section>
      ))}
      <details className="home-secondary-details">
        <summary>
          更多工作
          <CanonicalIcon name="down" size={15} />
        </summary>
        {rows(additional)}
      </details>
      <ErrorMessage error={membership.error} />
      <ActionButton action={onLogout}>退出登录</ActionButton>
    </div>
  );
}
