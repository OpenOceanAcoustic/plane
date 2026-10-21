/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Coins,
  FolderKanban,
  Handshake,
  PiggyBank,
  Plus,
  TableProperties,
  Target,
  Timer,
  Wallet,
} from "lucide-react";
// oxlint-disable-next-line import/no-unassigned-import -- shared workbench styles
import "./workbench.css";

type QuickLink = { href: string; label: string; icon: ReactNode };

const groups = (base: string): { title: string; links: QuickLink[] }[] => [
  {
    title: "我的工作",
    links: [
      { href: `${base}/planner`, label: "个人规划", icon: <FolderKanban size={14} /> },
      { href: `${base}/tasks`, label: "任务表格", icon: <TableProperties size={14} /> },
      { href: `${base}/finance?finance_view=cost`, label: "记工时", icon: <Timer size={14} /> },
      { href: `${base}/finance?finance_view=payroll`, label: "报销与工资", icon: <Banknote size={14} /> },
    ],
  },
  {
    title: "项目与钱",
    links: [
      { href: `${base}/finance?finance_view=income`, label: "入账", icon: <Wallet size={14} /> },
      { href: `${base}/finance?finance_view=project-budget`, label: "预算", icon: <PiggyBank size={14} /> },
      { href: `${base}/quality`, label: "质量资料", icon: <ClipboardCheck size={14} /> },
      { href: `${base}/bounties`, label: "悬赏大厅", icon: <Target size={14} /> },
      { href: `${base}/cash`, label: "现金悬赏", icon: <Banknote size={14} /> },
    ],
  },
  {
    title: "一起参与",
    links: [
      { href: `${base}/participation`, label: "参与管理", icon: <Handshake size={14} /> },
      { href: `${base}/team`, label: "团队排期", icon: <CalendarDays size={14} /> },
      { href: `${base}/planning`, label: "项目规划", icon: <CalendarRange size={14} /> },
      { href: `${base}/contributions`, label: "我的项目与贡献", icon: <Coins size={14} /> },
    ],
  },
];

const close = (event: MouseEvent<HTMLAnchorElement>) => {
  event.currentTarget.closest("details")?.removeAttribute("open");
};

export function LabQuickActions({ workspaceSlug }: { workspaceSlug: string }) {
  const base = `/${workspaceSlug}/lab`;
  return (
    <details className="lab-quick-actions">
      <summary className="lab-quick-actions-trigger">
        <Plus size={14} aria-hidden="true" />
        全部入口
      </summary>
      <div className="lab-quick-actions-panel">
        {groups(base).map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2>{group.title}</h2>
            <div className="lab-quick-actions-grid">
              {group.links.map((link) => (
                <Link key={link.href} className="lab-quick-action" to={link.href} onClick={close}>
                  <span aria-hidden="true">{link.icon}</span>
                  <span>{link.label}</span>
                  <ArrowRight className="ml-auto" size={12} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
