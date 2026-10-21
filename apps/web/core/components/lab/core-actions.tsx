/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { Link, useLocation } from "react-router";
import { ArrowRight, Banknote, ClipboardCheck, Handshake, TableProperties, Timer, Wallet } from "lucide-react";
// oxlint-disable-next-line import/no-unassigned-import -- shared workbench styles
import "./workbench.css";

type CoreAction = {
  key: string;
  label: string;
  hint: string;
  href: string;
  tone: "emerald" | "indigo" | "purple" | "orange" | "pink" | "blue";
  Icon: typeof Wallet;
  match: (path: string, params: URLSearchParams) => boolean;
};

export function LabCoreActions({ workspaceSlug }: { workspaceSlug: string }) {
  const base = `/${workspaceSlug}/lab`;
  const location = useLocation();
  const path = location.pathname.replace(/\/$/, "");
  const params = new URLSearchParams(location.search);
  const financePath = `${base}/finance`;
  const actions: CoreAction[] = [
    {
      key: "income",
      label: "入账",
      hint: "登记到账 / 期初余额",
      href: `${financePath}?finance_view=income`,
      tone: "emerald",
      Icon: Wallet,
      match: (current, query) => current === financePath && query.get("finance_view") === "income",
    },
    {
      key: "time",
      label: "登记工时",
      hint: "记录今天做了什么",
      href: `${financePath}?finance_view=cost`,
      tone: "indigo",
      Icon: Timer,
      match: (current, query) => current === financePath && query.get("finance_view") === "cost",
    },
    {
      key: "labor",
      label: "发放劳务",
      hint: "工资、报销与支付",
      href: `${financePath}?finance_view=payroll`,
      tone: "purple",
      Icon: Banknote,
      match: (current, query) => current === financePath && query.get("finance_view") === "payroll",
    },
    {
      key: "work",
      label: "记录工作项",
      hint: "任务、交付与排期",
      href: `${base}/tasks`,
      tone: "orange",
      Icon: TableProperties,
      match: (current) => current === `${base}/tasks`,
    },
    {
      key: "quality",
      label: "质量管理",
      hint: "资料、检查与验收",
      href: `${base}/quality`,
      tone: "pink",
      Icon: ClipboardCheck,
      match: (current) => current === `${base}/quality`,
    },
    {
      key: "participation",
      label: "成员参与",
      hint: "项目参与与授权",
      href: `${base}/participation`,
      tone: "blue",
      Icon: Handshake,
      match: (current) => current === `${base}/participation`,
    },
  ];
  return (
    <section className="lab-core-actions" aria-label="常用操作">
      <header className="lab-core-actions-head">
        <span className="lab-core-actions-badge">常用</span>
        <div>
          <h2>常用操作</h2>
          <p>入账、工时、劳务、工作项、质量、成员参与，从这里开始。</p>
        </div>
      </header>
      <div className="lab-core-actions-grid">
        {actions.map((action) => {
          const active = action.match(path, params);
          const Icon = action.Icon;
          return (
            <Link
              key={action.key}
              to={action.href}
              className="lab-core-action"
              data-tone={action.tone}
              aria-current={active ? "page" : undefined}
            >
              <span className="lab-core-action-icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <span className="lab-core-action-copy">
                <strong>{action.label}</strong>
                <small>{action.hint}</small>
              </span>
              <ArrowRight className="lab-core-action-arrow" size={16} aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
