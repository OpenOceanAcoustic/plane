/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { CSSProperties, ReactNode } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  Lightbulb,
  ListTodo,
  Plus,
  Sparkles,
  Star,
  Target,
  UserRound,
  Wallet,
} from "lucide-react";
import useSWR from "swr";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Button } from "@plane/propel/button";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { EIssuesStoreType } from "@plane/types";
import type { TLogoProps } from "@plane/types";
import { Avatar, AvatarGroup } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { useStickyOperations } from "@/components/stickies/sticky/use-operations";
import { useCurrentTime } from "@/hooks/use-current-time";
import { useSticky } from "@/hooks/use-stickies";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// oxlint-disable-next-line import/no-unassigned-import -- shared dashboard surfaces
import "../lab/workbench.css";
// oxlint-disable-next-line import/no-unassigned-import -- project-first home surfaces
import "./home-workbench.css";

export type HomeProjectMember = {
  id: string;
  name: string;
  avatarUrl?: string;
};

export type HomeProject = {
  id: string;
  name: string;
  identifier: string;
  description?: string;
  logoProps?: TLogoProps;
  isFavorite?: boolean;
  members: HomeProjectMember[];
  totalWorkItems: number;
  completedWorkItems: number;
};

export type HomeIdea = {
  id: string;
  title: string;
};

export type HomeWorkbenchViewProps = {
  workspaceSlug: string;
  userName: string;
  userAvatarUrl?: string;
  greeting: string;
  dateLabel: string;
  timeLabel: string;
  projects: HomeProject[];
  projectLabel: string;
  projectCount: number;
  favoriteCount: number;
  totalWorkItems: number;
  completedWorkItems: number;
  ideaCount: number;
  ideas: HomeIdea[];
  loading: boolean;
  statsLoading: boolean;
  creatingIdea: boolean;
  canCreateProject: boolean;
  canCreateWorkItem: boolean;
  canWriteIdea: boolean;
  onCreateWorkItem: () => void;
  onCreateProject: () => void;
  onCreateIdea: () => void;
};

const tones = ["indigo", "emerald", "orange", "purple", "pink"] as const;

function Metric({
  tone,
  icon,
  label,
  value,
  hint,
}: {
  tone: (typeof tones)[number];
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="lab-metric" data-tone={tone}>
      <p className="lab-metric-head">
        <span className="lab-metric-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </p>
      <p className="lab-metric-value">{value}</p>
      <p className="lab-metric-hint">{hint}</p>
    </article>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className="lab-quick-link">
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <ArrowRight aria-hidden="true" className="ml-auto" size={13} />
    </Link>
  );
}

function ProjectCard({
  project,
  workspaceSlug,
  tone,
  statsLoading,
}: {
  project: HomeProject;
  workspaceSlug: string;
  tone: (typeof tones)[number];
  statsLoading: boolean;
}) {
  const completed = project.completedWorkItems;
  const total = project.totalWorkItems;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const issuesHref = `/${workspaceSlug}/projects/${project.id}/issues`;
  return (
    <article className="lab-home-project-card" data-tone={tone} aria-label={project.name}>
      <div className="lab-home-project-head">
        <span className="lab-home-project-logo" aria-hidden="true">
          <Logo logo={project.logoProps} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={issuesHref} className="lab-home-project-name">
            {project.name}
          </Link>
          <p className="lab-home-project-identifier">
            {project.identifier}
            {project.isFavorite && <Star className="lab-home-favorite" size={11} aria-label="收藏项目" />}
          </p>
        </div>
      </div>
      <p className="lab-home-project-desc">{project.description?.trim() || "暂无项目描述"}</p>
      <div className="lab-home-project-progress">
        {statsLoading ? (
          <span>正在读取工作项…</span>
        ) : (
          <>
            <div className="lab-progress-track" aria-label={`${project.name}完成度 ${pct}%`}>
              <div
                className="lab-progress-fill"
                data-tone={pct >= 100 ? "emerald" : pct >= 60 ? "emerald" : pct > 0 ? "orange" : "crimson"}
                style={{ "--progress": `${pct}%` } as CSSProperties}
              />
            </div>
            <span>{total > 0 ? `${completed} / ${total} 个工作项` : "暂无工作项"}</span>
          </>
        )}
      </div>
      <div className="lab-home-project-foot">
        <div className="lab-home-project-members">
          {project.members.length ? (
            <>
              <AvatarGroup showTooltip={false}>
                {project.members.slice(0, 3).map((member) => (
                  <Avatar key={member.id} name={member.name} src={member.avatarUrl} />
                ))}
              </AvatarGroup>
              {project.members.length > 3 && <span>+{project.members.length - 3}</span>}
            </>
          ) : (
            <span>暂无成员</span>
          )}
        </div>
        <nav className="lab-home-project-links" aria-label={`${project.name}快捷入口`}>
          <Link
            className="lab-project-action"
            data-tone="indigo"
            href={`/${workspaceSlug}/lab/planning?project_id=${encodeURIComponent(project.id)}`}
            title="项目规划"
          >
            <CalendarRange size={11} />
            规划
          </Link>
          <Link
            className="lab-project-action"
            data-tone="emerald"
            href={`/${workspaceSlug}/lab/finance?project_id=${encodeURIComponent(project.id)}`}
            title="项目资金与预算"
          >
            <Wallet size={11} />
            资金
          </Link>
          <Link
            className="lab-project-action"
            data-tone="pink"
            href={`/${workspaceSlug}/lab/quality?project_id=${encodeURIComponent(project.id)}`}
            title="项目质量资料"
          >
            <ClipboardCheck size={11} />
            质量
          </Link>
        </nav>
      </div>
    </article>
  );
}

type NextAction = {
  id: string;
  kind: string;
  title: string;
  amount: string;
  unit: string;
  project: string;
  status: string;
  action: string;
  url: string;
};

export function HomeWorkbenchView(props: HomeWorkbenchViewProps) {
  const {
    workspaceSlug,
    userName,
    userAvatarUrl,
    greeting,
    dateLabel,
    timeLabel,
    projects,
    projectLabel,
    projectCount,
    favoriteCount,
    totalWorkItems,
    completedWorkItems,
    ideaCount,
    ideas,
    loading,
    statsLoading,
    creatingIdea,
    canCreateProject,
    canCreateWorkItem,
    canWriteIdea,
    onCreateWorkItem,
    onCreateProject,
    onCreateIdea,
  } = props;
  const { data: nextActionData } = useSWR<{ items: NextAction[] }>(
    workspaceSlug ? ["home-next-actions", workspaceSlug] : null,
    workspaceSlug
      ? () =>
          fetch(`/api/workspaces/${workspaceSlug}/lab/me/next-actions/`, { credentials: "include" }).then((response) =>
            response.ok ? response.json() : { items: [] }
          )
      : null,
    { revalidateOnFocus: false }
  );
  const nextActions = nextActionData?.items ?? [];
  const activeWorkItems = Math.max(0, totalWorkItems - completedWorkItems);
  const completion = totalWorkItems > 0 ? Math.round((completedWorkItems / totalWorkItems) * 100) : 0;
  const statsValue = statsLoading ? "—" : `${activeWorkItems}`;
  const completedValue = statsLoading ? "—" : `${completedWorkItems}`;
  return (
    <section className="lab-home-workbench" aria-label="项目工作台">
      <div className="lab-command lab-home-command">
        <div className="lab-home-intro">
          <span className="lab-home-avatar" aria-hidden="true">
            {userAvatarUrl ? <Avatar name={userName} src={userAvatarUrl} /> : userName.trim().slice(0, 1) || "我"}
          </span>
          <div className="min-w-0">
            <h1>
              {greeting}，{userName}
            </h1>
            <p>
              {dateLabel} · {timeLabel}
            </p>
          </div>
        </div>
        <div className="lab-command-chips">
          <span className="lab-command-chip">
            参与项目 <strong>{projectCount}</strong>
          </span>
          <span className="lab-command-chip">
            进行中 <strong>{statsValue}</strong>
          </span>
          <span className="lab-command-chip">
            想法 <strong>{ideaCount}</strong>
          </span>
        </div>
        <div className="lab-command-actions">
          {canCreateWorkItem && (
            <Button variant="primary" size="lg" onClick={onCreateWorkItem} prependIcon={<Plus size={16} />}>
              新建工作项
            </Button>
          )}
          {canCreateProject && (
            <Button variant="secondary" size="lg" onClick={onCreateProject} prependIcon={<FolderKanban size={16} />}>
              新建项目
            </Button>
          )}
          {canWriteIdea && (
            <Button
              variant="secondary"
              size="lg"
              onClick={onCreateIdea}
              loading={creatingIdea}
              prependIcon={<Lightbulb size={16} />}
            >
              写想法
            </Button>
          )}
        </div>
      </div>

      <div className="lab-metric-grid" aria-label="项目概览">
        <Metric
          tone="indigo"
          icon={<FolderKanban size={15} />}
          label="参与项目"
          value={`${projectCount}`}
          hint={projectCount ? `${favoriteCount} 个收藏项目` : "还没有参与项目"}
        />
        <Metric
          tone="orange"
          icon={<ListTodo size={15} />}
          label="进行中工作项"
          value={statsValue}
          hint={statsLoading ? "正在读取工作项" : `共 ${totalWorkItems} 个工作项`}
        />
        <Metric
          tone="emerald"
          icon={<CheckCircle2 size={15} />}
          label="已完成"
          value={completedValue}
          hint={statsLoading ? "正在读取完成情况" : `完成度 ${completion}%`}
        />
        <Metric
          tone="purple"
          icon={<Lightbulb size={15} />}
          label="我的想法"
          value={`${ideaCount}`}
          hint={`${ideas.length} 条最近想法`}
        />
        <Metric
          tone="pink"
          icon={<Star size={15} />}
          label="收藏项目"
          value={`${favoriteCount}`}
          hint={favoriteCount ? "常用项目置顶显示" : "可在项目卡片中收藏"}
        />
      </div>

      <div className="lab-workbench-grid">
        <section className="lab-workbench-panel" aria-label={projectLabel}>
          <header className="lab-workbench-panel-head">
            <h2>{projectLabel}</h2>
            <Link
              href={`/${workspaceSlug}/projects/`}
              className="inline-flex items-center gap-1 text-12 text-accent-primary"
            >
              全部项目
              <ArrowRight size={13} />
            </Link>
          </header>
          {loading ? (
            <div className="lab-home-project-grid">
              {[0, 1].map((index) => (
                <div className="lab-home-skeleton" key={index} aria-hidden="true">
                  <div className="lab-home-skeleton-line w-2/3" />
                  <div className="lab-home-skeleton-line w-full" />
                  <div className="lab-home-skeleton-line w-1/2" />
                </div>
              ))}
            </div>
          ) : projects.length ? (
            <div className="lab-home-project-grid">
              {projects.map((project, index) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  workspaceSlug={workspaceSlug}
                  tone={tones[index % tones.length]}
                  statsLoading={statsLoading}
                />
              ))}
            </div>
          ) : (
            <div className="lab-home-empty">
              <p>还没有参与项目。创建一个项目，把工作项、资金和质量资料放在一起。</p>
              {canCreateProject ? (
                <Button variant="primary" size="base" onClick={onCreateProject} prependIcon={<Plus size={15} />}>
                  新建项目
                </Button>
              ) : (
                <Link href={`/${workspaceSlug}/projects/`} className="text-13 text-accent-primary">
                  浏览工作区项目
                </Link>
              )}
            </div>
          )}
        </section>

        <aside className="lab-workbench-panel" aria-label="下一步与项目进度">
          <header className="lab-workbench-panel-head">
            <h2>下一步</h2>
            <Sparkles size={15} className="text-secondary" aria-hidden="true" />
          </header>
          <div className="lab-next-actions" aria-label="待处理悬赏">
            {nextActions.length ? (
              nextActions.slice(0, 6).map((row) => (
                <Link key={`${row.kind}-${row.id}`} href={row.url} className="lab-next-action">
                  <span className="lab-next-action-main">
                    <strong>{row.title}</strong>
                    <small>
                      {row.project}
                      {row.amount ? ` · ${row.unit}${row.amount}` : ""}
                    </small>
                  </span>
                  <span className="lab-next-action-tag">{row.action}</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              ))
            ) : (
              <p className="text-12 text-secondary">当前没有待领取、待提交、待验收、待付款或待评审的事项。</p>
            )}
            <Link href={`/${workspaceSlug}/lab/bounties`} className="lab-next-all">
              查看全部悬赏
              <ArrowRight size={12} />
            </Link>
          </div>
          <header className="lab-workbench-panel-head">
            <h2>项目进度</h2>
            <Sparkles size={15} className="text-secondary" aria-hidden="true" />
          </header>
          <div className="lab-home-progress-block">
            <div
              className="lab-home-ring"
              style={{ "--pct": completion } as CSSProperties}
              aria-label={`整体完成度 ${completion}%`}
            >
              <div className="lab-home-ring-inner">
                <strong>{completion}%</strong>
                <span>已完成</span>
              </div>
            </div>
            <div className="lab-home-progress-copy">
              <p>
                已完成 <strong>{completedWorkItems}</strong> / {totalWorkItems} 个工作项
              </p>
              <p>
                进行中 <strong>{activeWorkItems}</strong> 个
              </p>
              <div className="lab-progress-track" aria-hidden="true">
                <div
                  className="lab-progress-fill"
                  data-tone={completion >= 70 ? "emerald" : completion >= 30 ? "orange" : "crimson"}
                  style={{ "--progress": `${completion}%` } as CSSProperties}
                />
              </div>
            </div>
          </div>

          <div className="lab-home-ideas">
            <div className="lab-home-subhead">
              最新想法
              <Link href={`/${workspaceSlug}/stickies/`}>全部</Link>
            </div>
            {ideas.length ? (
              ideas.map((idea) => (
                <Link key={idea.id} href={`/${workspaceSlug}/stickies/`} className="lab-home-idea">
                  <span className="lab-home-idea-dot" aria-hidden="true" />
                  <span className="lab-home-idea-title">{idea.title}</span>
                </Link>
              ))
            ) : (
              <p className="text-12 text-secondary">还没有想法，随手记一条。</p>
            )}
          </div>

          <div className="lab-quick-links" aria-label="快捷入口">
            <QuickLink href={`/${workspaceSlug}/profile/`} icon={<UserRound size={14} />} label="我的工作" />
            <QuickLink href={`/${workspaceSlug}/projects/`} icon={<FolderKanban size={14} />} label="全部项目" />
            <QuickLink href={`/${workspaceSlug}/stickies/`} icon={<Lightbulb size={14} />} label="想法便签" />
            <QuickLink href={`/${workspaceSlug}/lab/finance`} icon={<Wallet size={14} />} label="资金与奖励" />
            <QuickLink href={`/${workspaceSlug}/lab/quality`} icon={<ClipboardCheck size={14} />} label="项目与质量" />
            <QuickLink href={`/${workspaceSlug}/lab/planning`} icon={<CalendarRange size={14} />} label="项目规划" />
            <QuickLink href={`/${workspaceSlug}/lab/bounties`} icon={<Target size={14} />} label="悬赏大厅" />
            <QuickLink href={`/${workspaceSlug}/lab/analytics`} icon={<BarChart3 size={14} />} label="数据总览" />
          </div>
        </aside>
      </div>
    </section>
  );
}

const monthDay = (time: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone,
  }).format(time);

const clock = (time: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(time);

const hourOf = (time: Date, timeZone?: string) =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone,
    }).format(time)
  );

const plainTitle = (name?: string, html?: string) => {
  if (name?.trim()) return name.trim();
  const text = (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 36) || "空白想法";
};

export const HomeWorkbench = observer(function HomeWorkbench() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const { data: currentUser } = useUser();
  const { currentTime } = useCurrentTime();
  const {
    loader,
    joinedProjectIds,
    workspaceProjectIds,
    favoriteProjectIds,
    getProjectById,
    getProjectAnalyticsCountById,
    fetchProjectAnalyticsCount,
  } = useProject();
  const { getUserDetails } = useMember();
  const { allowPermissions } = useUserPermissions();
  const { toggleCreateIssueModal, toggleCreateProjectModal } = useCommandPalette();
  const { fetchWorkspaceStickies, getWorkspaceStickyIds, stickies, creatingSticky, toggleShowNewSticky } = useSticky();
  const { stickyOperations } = useStickyOperations({ workspaceSlug: slug });
  const timeZone = currentUser?.user_timezone;

  const { isLoading: statsLoading } = useSWR(
    slug ? ["home-project-stats", slug] : null,
    slug
      ? () =>
          fetchProjectAnalyticsCount(slug, {
            fields: "total_work_items,total_completed_work_items,total_members",
          })
      : null,
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: true }
  );

  useSWR(slug ? `WORKSPACE_STICKIES_${slug}` : null, slug ? () => fetchWorkspaceStickies(slug) : null, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
  });

  const activeProjectIds = joinedProjectIds.length ? joinedProjectIds : (workspaceProjectIds ?? []);
  const sortedProjectIds = [...activeProjectIds].filter((id) => {
    const project = getProjectById(id);
    return !!project && !project.archived_at;
  });
  // oxlint-disable-next-line no-array-sort -- local copy is sorted for display only
  sortedProjectIds.sort(
    (left, right) => Number(favoriteProjectIds.includes(right)) - Number(favoriteProjectIds.includes(left))
  );
  const visibleProjectIds = sortedProjectIds.slice(0, 6);
  const projects: HomeProject[] = visibleProjectIds.flatMap((id) => {
    const project = getProjectById(id);
    if (!project) return [];
    const statsRow = getProjectAnalyticsCountById(project.id);
    const members = (project.members ?? []).slice(0, 4).flatMap((memberId) => {
      const member = getUserDetails(memberId);
      if (!member) return [];
      return [
        {
          id: member.id,
          name: member.display_name,
          avatarUrl: member.avatar_url ? getFileURL(member.avatar_url) : undefined,
        },
      ];
    });
    return [
      {
        id: project.id,
        name: project.name,
        identifier: project.identifier,
        description: project.description,
        logoProps: project.logo_props,
        isFavorite: project.is_favorite,
        members,
        totalWorkItems: statsRow?.total_issues ?? 0,
        completedWorkItems: statsRow?.completed_issues ?? 0,
      },
    ];
  });
  const allProjectStats = activeProjectIds.map((id) => getProjectAnalyticsCountById(id));
  const totalWorkItems = allProjectStats.reduce((sum, row) => sum + (row?.total_issues ?? 0), 0);
  const completedWorkItems = allProjectStats.reduce((sum, row) => sum + (row?.completed_issues ?? 0), 0);
  const projectCount = activeProjectIds.length;
  const favoriteCount = favoriteProjectIds.length;
  const ideaIds = slug ? getWorkspaceStickyIds(slug) : [];
  const ideaCount = ideaIds.length;
  const ideas: HomeIdea[] = ideaIds.slice(0, 3).flatMap((id) => {
    const sticky = stickies[id];
    if (!sticky) return [];
    return [{ id, title: plainTitle(sticky.name, sticky.description_html) }];
  });

  const hour = hourOf(currentTime, timeZone);
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const userName =
    currentUser?.display_name?.trim() ||
    `${currentUser?.first_name ?? ""} ${currentUser?.last_name ?? ""}`.trim() ||
    "同事";
  const canCreateProject = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );
  const canWriteIdea = canCreateProject;
  const canCreateWorkItem = activeProjectIds.length > 0;
  const onCreateWorkItem = () => toggleCreateIssueModal(true, EIssuesStoreType.PROJECT, activeProjectIds);
  const onCreateProject = () => toggleCreateProjectModal(true);
  const onCreateIdea = () => {
    if (!slug) return;
    toggleShowNewSticky(true);
    void stickyOperations.create();
  };

  return (
    <HomeWorkbenchView
      workspaceSlug={slug}
      userName={userName}
      userAvatarUrl={currentUser?.avatar_url ? getFileURL(currentUser.avatar_url) : undefined}
      greeting={greeting}
      dateLabel={monthDay(currentTime, timeZone)}
      timeLabel={clock(currentTime, timeZone)}
      projects={projects}
      projectLabel={joinedProjectIds.length ? "我的项目" : "工作区项目"}
      projectCount={projectCount}
      favoriteCount={favoriteCount}
      totalWorkItems={totalWorkItems}
      completedWorkItems={completedWorkItems}
      ideaCount={ideaCount}
      ideas={ideas}
      loading={loader === "init-loader"}
      statsLoading={statsLoading}
      creatingIdea={creatingSticky}
      canCreateProject={canCreateProject}
      canCreateWorkItem={canCreateWorkItem}
      canWriteIdea={canWriteIdea}
      onCreateWorkItem={onCreateWorkItem}
      onCreateProject={onCreateProject}
      onCreateIdea={onCreateIdea}
    />
  );
});
