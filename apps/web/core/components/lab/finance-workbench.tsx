/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  ClipboardList,
  Coins,
  PiggyBank,
  Plus,
  ReceiptText,
  ShieldCheck,
  Timer,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { LabFinanceManagement, LabManagementRecord } from "@plane/types";
import { Button, labDecimalText, labDecimalUnits } from "@plane/ui";
import type { FinanceManagementAction } from "./finance-management-form";
import { managementStates } from "./management-ui";

const cents = (value: string | null | undefined) => labDecimalUnits(value ?? "0") ?? 0n;
const amountOf = (row: LabManagementRecord) => row.recognized_amount ?? row.data.amount ?? "0";
const dateOf = (row: LabManagementRecord) => row.data.date ?? row.data.start ?? row.created_at.slice(0, 10);
const hoursOf = (row: LabManagementRecord) => {
  const hours = Number(row.data.hours);
  return Number.isFinite(hours) ? hours : 0;
};
const sumAmount = (rows: LabManagementRecord[]) => rows.reduce((sum, row) => sum + cents(amountOf(row)), 0n);
const monthKey = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 7);
const money = (value: bigint) => `¥${labDecimalText(value)}`;
const percentage = (value: bigint, total: bigint) =>
  total > 0n ? Math.min(100, Math.max(0, Number((value * 100n) / total))) : 0;
const progressTone = (value: number) => (value >= 100 ? "crimson" : value >= 80 ? "orange" : "emerald");

export function Metric({
  tone,
  icon,
  label,
  value,
  hint,
}: {
  tone: "emerald" | "indigo" | "orange" | "purple" | "crimson";
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

function ProgressBar({
  label,
  budget,
  cost,
  remaining,
}: {
  label: string;
  budget: string;
  cost: string;
  remaining: string;
}) {
  const budgetUnits = cents(budget);
  const costUnits = cents(cost);
  const pct = percentage(costUnits, budgetUnits);
  return (
    <div className="lab-budget-row">
      <div className="lab-budget-meta">
        <span className="lab-budget-name">{label}</span>
        <span className="lab-budget-figures">
          已用 <strong>{money(costUnits)}</strong> / {money(budgetUnits)} · 余 {money(cents(remaining))}
        </span>
      </div>
      <div className="lab-progress-track" aria-label={`${label}预算执行 ${pct}%`}>
        <div
          className="lab-progress-fill"
          data-tone={progressTone(pct)}
          style={{ "--progress": `${pct}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}

export function StatusPill({ state }: { state: string }) {
  return (
    <span className="lab-status-pill" data-state={state}>
      {managementStates[state] ?? state}
    </span>
  );
}

function QuickLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="lab-quick-link" onClick={onClick}>
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <ArrowRight aria-hidden="true" className="ml-auto" size={13} />
    </button>
  );
}

export function FinanceWorkbench({
  management,
  canViewFinance,
  canRecord,
  canApprove,
  canPay,
  closed,
  onAction,
  onTab,
}: {
  management: LabFinanceManagement | undefined;
  canViewFinance: boolean;
  canRecord: boolean;
  canApprove: boolean;
  canPay: boolean;
  closed: boolean;
  onAction: (action: FinanceManagementAction) => void;
  onTab: (tab: string) => void;
}) {
  if (!management) return <p className="text-13 text-secondary">正在读取项目财务数据…</p>;
  const myId = management.user_id;
  const projectCosts = management.records.filter((row) => row.kind === "cost" && row.state !== "cancelled");
  const projectPayrolls = management.records.filter((row) => row.kind === "payroll");
  const costs = canViewFinance ? projectCosts : projectCosts.filter((row) => row.data.user_id === myId);
  const payrolls = canViewFinance ? projectPayrolls : projectPayrolls.filter((row) => row.data.user_id === myId);
  const month = monthKey();
  const monthCosts = costs.filter((row) => dateOf(row).startsWith(month));
  const monthHours = monthCosts.reduce((sum, row) => sum + hoursOf(row), 0);
  const monthAmount = sumAmount(monthCosts);
  const pendingCosts = costs.filter((row) => row.state === "submitted");
  const pendingPayrolls = payrolls.filter((row) => row.state === "ready");
  const paidPayrolls = payrolls.filter((row) => row.state === "paid");
  const pendingCostAmount = sumAmount(pendingCosts);
  const pendingPayrollAmount = sumAmount(pendingPayrolls);
  const paidPayrollAmount = sumAmount(paidPayrolls);
  const summary = management.summary;
  const budgetAmount = summary?.budget ?? "0.00";
  const spentAmount = summary?.cost ?? "0.00";
  const remainingAmount = summary?.remaining ?? "0.00";
  const todoCount = pendingCosts.length + pendingPayrolls.length;
  const available = management.accounts.reduce((sum, account) => sum + cents(account.available), 0n);
  const recent = [...costs, ...payrolls];
  // oxlint-disable-next-line no-array-sort -- local copy is sorted for display only
  recent.sort((left, right) => dateOf(right).localeCompare(dateOf(left)));
  const recentRows = recent.slice(0, 6);
  const managerView = canViewFinance;
  return (
    <div className="lab-workbench">
      <section className="lab-metric-grid" aria-label="财务概览">
        {managerView ? (
          <>
            <Metric
              tone="indigo"
              icon={<PiggyBank size={15} />}
              label="核定预算"
              value={money(cents(budgetAmount))}
              hint={`已执行 ${money(cents(spentAmount))} · 余量 ${money(cents(remainingAmount))}`}
            />
            <Metric
              tone="emerald"
              icon={<Wallet size={15} />}
              label="可用资金"
              value={money(available)}
              hint={`${management.accounts.length} 个资金账户`}
            />
            <Metric
              tone="orange"
              icon={<Timer size={15} />}
              label="本月工时"
              value={`${monthHours} 小时`}
              hint={`本月登记 ${monthCosts.length} 笔 · ${money(monthAmount)}`}
            />
            <Metric
              tone="purple"
              icon={<Banknote size={15} />}
              label="待发工资"
              value={money(pendingPayrollAmount)}
              hint={`${pendingPayrolls.length} 张工资单待支付`}
            />
            <Metric
              tone="crimson"
              icon={<ClipboardList size={15} />}
              label="待我处理"
              value={`${todoCount} 项`}
              hint={`${pendingCosts.length} 笔待审核 · ${pendingPayrolls.length} 张待支付`}
            />
          </>
        ) : (
          <>
            <Metric
              tone="orange"
              icon={<Timer size={15} />}
              label="本月工时"
              value={`${monthHours} 小时`}
              hint={`本月登记 ${monthCosts.length} 笔 · ${money(monthAmount)}`}
            />
            <Metric
              tone="indigo"
              icon={<ReceiptText size={15} />}
              label="我的待审费用"
              value={money(pendingCostAmount)}
              hint={`${pendingCosts.length} 笔正在审核`}
            />
            <Metric
              tone="purple"
              icon={<Banknote size={15} />}
              label="待发工资"
              value={money(pendingPayrollAmount)}
              hint={`${pendingPayrolls.length} 张工资单待支付`}
            />
            <Metric
              tone="emerald"
              icon={<TrendingUp size={15} />}
              label="已发工资"
              value={money(paidPayrollAmount)}
              hint={`${paidPayrolls.length} 张工资单已支付`}
            />
            <Metric
              tone="crimson"
              icon={<CalendarClock size={15} />}
              label="我的记录"
              value={`${costs.length} 笔`}
              hint={`累计 ${costs.reduce((sum, row) => sum + hoursOf(row), 0)} 小时`}
            />
          </>
        )}
      </section>

      <div className="lab-workbench-grid">
        <section className="lab-workbench-panel" aria-label={managerView ? "预算执行" : "我的工时"}>
          <header className="lab-workbench-panel-head">
            <h2>{managerView ? "预算执行" : "我的工时明细"}</h2>
            <Button size="sm" variant="neutral-primary" onClick={() => onTab(managerView ? "project-budget" : "cost")}>
              {managerView ? "预算明细" : "全部记录"}
            </Button>
          </header>
          {managerView ? (
            <>
              <ProgressBar label="项目总预算" budget={budgetAmount} cost={spentAmount} remaining={remainingAmount} />
              {management.categories.length ? (
                management.categories
                  .filter((row) => cents(row.budget) > 0n || cents(row.cost) > 0n)
                  .map((row) => (
                    <ProgressBar
                      key={row.category}
                      label={row.label}
                      budget={row.budget}
                      cost={row.cost}
                      remaining={row.remaining}
                    />
                  ))
              ) : (
                <p className="text-12 text-secondary">尚未编制项目预算。</p>
              )}
            </>
          ) : monthCosts.length ? (
            <div className="lab-todo-list">
              {monthCosts.slice(0, 6).map((row) => (
                <div className="lab-todo" key={row.id}>
                  <span className="lab-record-kind" data-kind="cost">
                    工时
                  </span>
                  <div className="lab-todo-main">
                    <p className="lab-todo-title">{row.data.work || "工时记录"}</p>
                    <p className="lab-todo-meta">
                      <span>{dateOf(row)}</span>
                      <span>{hoursOf(row)} 小时</span>
                      <span>{row.data.team_name || "个人"}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="lab-todo-amount">{money(cents(amountOf(row)))}</p>
                    <StatusPill state={row.state} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-13 text-secondary">本月还没有工时记录。</p>
              {canRecord && (
                <Button size="sm" variant="primary" onClick={() => onAction({ kind: "cost", action: "save" })}>
                  <Plus size={14} className="mr-1" />
                  登记工时
                </Button>
              )}
            </div>
          )}
        </section>

        <section className="lab-workbench-panel" aria-label="待办与快捷入口">
          <header className="lab-workbench-panel-head">
            <h2>{managerView ? "待我处理" : "我的待办"}</h2>
            {todoCount > 0 && (
              <span className="lab-status-pill" data-state="submitted">
                {todoCount} 项
              </span>
            )}
          </header>
          {pendingCosts.length || pendingPayrolls.length ? (
            <div className="lab-todo-list">
              {pendingCosts.slice(0, 3).map((row) => (
                <div className="lab-todo" key={row.id}>
                  <span className="lab-record-kind" data-kind="cost">
                    费用
                  </span>
                  <div className="lab-todo-main">
                    <p className="lab-todo-title">{row.data.work || "费用记录"}</p>
                    <p className="lab-todo-meta">
                      <span>{row.data.user_name}</span>
                      <span>{dateOf(row)}</span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="lab-todo-amount">{money(cents(amountOf(row)))}</span>
                    {canApprove && !closed ? (
                      <Button size="sm" variant="primary" onClick={() => onTab("cost")}>
                        去审核
                      </Button>
                    ) : (
                      <StatusPill state={row.state} />
                    )}
                  </div>
                </div>
              ))}
              {pendingPayrolls.slice(0, 3).map((row) => (
                <div className="lab-todo" key={row.id}>
                  <span className="lab-record-kind" data-kind="payroll">
                    工资
                  </span>
                  <div className="lab-todo-main">
                    <p className="lab-todo-title">工资单 · {row.data.user_name}</p>
                    <p className="lab-todo-meta">
                      <span>
                        {row.data.start} 至 {row.data.end}
                      </span>
                      <span>{row.data.hours} 小时</span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="lab-todo-amount">{money(cents(amountOf(row)))}</span>
                    {canPay && !closed ? (
                      <Button size="sm" onClick={() => onTab("payroll")}>
                        去支付
                      </Button>
                    ) : (
                      <StatusPill state={row.state} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-13 text-secondary">当前没有待办。</p>
              {canRecord && !closed && (
                <Button size="sm" variant="neutral-primary" onClick={() => onAction({ kind: "cost", action: "save" })}>
                  补记工时
                </Button>
              )}
            </div>
          )}
          <div className="lab-quick-links" aria-label="快捷入口">
            <QuickLink icon={<Banknote size={14} />} label="入账" onClick={() => onTab("income")} />
            {managerView && (
              <QuickLink icon={<PiggyBank size={14} />} label="项目预算" onClick={() => onTab("project-budget")} />
            )}
            <QuickLink icon={<Timer size={14} />} label="工时与费用" onClick={() => onTab("cost")} />
            <QuickLink icon={<Banknote size={14} />} label="工资与报销" onClick={() => onTab("payroll")} />
            <QuickLink icon={<Wallet size={14} />} label="资金账户" onClick={() => onTab("accounts")} />
            {management.can_audit && (
              <QuickLink icon={<ShieldCheck size={14} />} label="财务审计" onClick={() => onTab("audit")} />
            )}
            <QuickLink icon={<Coins size={14} />} label="账目明细" onClick={() => onTab("ledger")} />
          </div>
        </section>
      </div>

      <section className="lab-workbench-panel" aria-label="最近财务记录">
        <header className="lab-workbench-panel-head">
          <h2>最近记录</h2>
          <Button size="sm" variant="neutral-primary" onClick={() => onTab("ledger")}>
            查看账目
          </Button>
        </header>
        {recentRows.length ? (
          <div className="overflow-x-auto rounded-lg border border-subtle">
            <table className="w-full text-left text-12">
              <thead className="bg-layer-1">
                <tr>
                  {["日期／成员", "类型与事项", "金额", "状态", "操作"].map((label) => (
                    <th key={label} className="px-3 py-2 font-medium whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentRows.map((row) => (
                  <tr key={row.id} className="border-t border-subtle">
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {dateOf(row)}
                      <p className="text-secondary">{row.data.user_name ?? row.actor}</p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="lab-record-kind" data-kind={row.kind}>
                        {row.kind === "payroll" ? "工资" : "费用"}
                      </span>
                      <p className="mt-1 max-w-80 break-words">
                        {row.kind === "payroll" ? `工资单 · ${row.data.start} 至 ${row.data.end}` : row.data.work}
                      </p>
                    </td>
                    <td className="font-mono px-3 py-2 align-top whitespace-nowrap">{money(cents(amountOf(row)))}</td>
                    <td className="px-3 py-2 align-top">
                      <StatusPill state={row.state} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Button
                        size="sm"
                        variant="neutral-primary"
                        onClick={() => onTab(row.kind === "payroll" ? "payroll" : "cost")}
                      >
                        查看
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-13 text-secondary">暂无财务记录。</p>
        )}
      </section>
    </div>
  );
}
