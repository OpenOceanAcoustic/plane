/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { ReactNode } from "react";
import useSWR from "swr";
import type { LabFinanceManagement, LabManagementRecord } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Banknote, Coins, PiggyBank, ReceiptText, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { Button, labDecimalText, labDecimalUnits } from "@plane/ui";
import { Metric, StatusPill } from "./finance-workbench";
import { FinanceManagementDialog } from "./finance-management-form";
import type { FinanceManagementAction } from "./finance-management-form";
import {
  costCategories,
  ManagementHistory,
  ManagementTable,
  managementCell as cell,
  downloadManagement,
} from "./management-ui";

export function LabFinanceManagement({
  store,
  projectId,
  refreshKey,
  view = "overview",
  onAccountAction,
  accountActions = [],
}: {
  store: LabStore;
  projectId: string;
  refreshKey: number;
  view?: string;
  onAccountAction?: (action: string) => void;
  accountActions?: string[];
}) {
  const path = `projects/${projectId}/finance-management/`;
  const { data, error, mutate } = useSWR(
    ["lab-finance-management", store.slug, projectId, refreshKey],
    () => store.request<LabFinanceManagement>(path),
    { keepPreviousData: true }
  );
  const [tab, setTab] = useState(view);
  const [chosen, setChosen] = useState<FinanceManagementAction>();
  const [history, setHistory] = useState<LabManagementRecord>();
  const [failure, setFailure] = useState("");
  const [exporting, setExporting] = useState(false);
  const funding = data?.records.find((row) => row.kind === "funding");
  const records =
    data?.records.filter((row) => row.kind === (tab === "payroll" ? "payroll" : tab === "audit" ? "audit" : "cost")) ??
    [];
  if (!data)
    return (
      <p role={error ? "alert" : undefined}>{error instanceof Error ? error.message : "正在读取项目经费与成本…"}</p>
    );
  const summaryMetrics: {
    tone: "emerald" | "indigo" | "orange" | "purple" | "crimson";
    label: string;
    value: string;
    hint: string;
    icon: ReactNode;
  }[] = data.summary
    ? [
        {
          tone: "emerald",
          label: "核定项目经费",
          value: data.summary.funding,
          hint: "资金来源",
          icon: <Banknote size={15} />,
        },
        {
          tone: "indigo",
          label: "核定预算",
          value: data.summary.budget,
          hint: "启动预算",
          icon: <PiggyBank size={15} />,
        },
        {
          tone: "emerald",
          label: "累计实际到账",
          value: data.summary.received,
          hint: "已到账",
          icon: <Coins size={15} />,
        },
        {
          tone: "emerald",
          label: "资金可用余额",
          value: labDecimalText(
            data.accounts.reduce((sum, account) => sum + (labDecimalUnits(account.available) ?? 0n), 0n)
          ),
          hint: "可承诺",
          icon: <Wallet size={15} />,
        },
        {
          tone: "orange",
          label: "已认定执行成本",
          value: data.summary.cost,
          hint: "已发生",
          icon: <ReceiptText size={15} />,
        },
        {
          tone: "purple",
          label: "预算余量",
          value: data.summary.remaining,
          hint: "剩余",
          icon: <TrendingUp size={15} />,
        },
        {
          tone: "purple",
          label: "工资与报销已支付",
          value: data.summary.paid,
          hint: "已支付",
          icon: <Banknote size={15} />,
        },
        {
          tone: "crimson",
          label: "审计待追回",
          value: data.summary.recovery,
          hint: "待追回",
          icon: <ShieldCheck size={15} />,
        },
        {
          tone: "emerald",
          label: "审计已追回",
          value: data.summary.recovered,
          hint: "已追回",
          icon: <Coins size={15} />,
        },
      ]
    : [];
  return (
    <section className="space-y-4" aria-label="项目经费与成本">
      {chosen && (
        <FinanceManagementDialog
          key={`${chosen.kind}-${chosen.action}-${chosen.row?.id ?? "new"}`}
          store={store}
          path={path}
          data={data}
          chosen={chosen}
          onAccountAction={onAccountAction}
          accountActions={accountActions}
          onClose={() => setChosen(undefined)}
          onSaved={async () => {
            await mutate();
          }}
        />
      )}
      {history && (
        <ManagementHistory store={store} path={path} record={history} onClose={() => setHistory(undefined)} />
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadManagement(store, `${path}?format=csv`, "项目财务报表.csv");
            } catch (problem) {
              setFailure(problem instanceof Error ? problem.message : "导出失败");
            } finally {
              setExporting(false);
            }
          }}
        >
          导出财务报表
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-danger-primary">
          {failure}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger-primary">
          {error instanceof Error ? error.message : "项目财务读取失败"}
        </p>
      )}
      {summaryMetrics.length > 0 && (
        <div className="lab-metric-grid">
          {summaryMetrics.map((metric) => (
            <Metric
              key={metric.label}
              tone={metric.tone}
              icon={metric.icon}
              label={metric.label}
              value={`¥${metric.value}`}
              hint={`${metric.hint}（元）`}
            />
          ))}
        </div>
      )}
      {tab === "overview" && (
        <section className="lab-workbench-panel space-y-3">
          <header className="lab-workbench-panel-head">
            <h2>经费核定</h2>
            <div className="flex flex-wrap gap-2">
              {data.can_record && !data.closed && (
                <Button size="sm" onClick={() => setChosen({ kind: "funding", action: "save", row: funding })}>
                  {funding ? "调整核定经费" : "核定项目经费"}
                </Button>
              )}
              {funding && (
                <Button size="sm" variant="neutral-primary" onClick={() => setHistory(funding)}>
                  核定历史
                </Button>
              )}
            </div>
          </header>
          {funding ? (
            <div className="space-y-2 rounded-lg border border-subtle bg-layer-1 p-4 text-13">
              <p>项目类型：{funding.data.source_type === "external" ? "外部项目" : "内部项目"}</p>
              <p>合同／决议编号：{funding.data.reference || "—"}</p>
              <p className="whitespace-pre-wrap">核定依据：{funding.data.basis}</p>
              <p>
                版本：V{funding.version} · {funding.actor}
              </p>
            </div>
          ) : (
            <p className="text-13 text-secondary">尚未核定项目经费</p>
          )}
          {!!data.categories.length && (
            <ManagementTable headings={["费用类别", "启动预算（元）", "认定成本（元）", "分类余量（元）"]}>
              {data.categories.map((row) => (
                <tr key={row.category}>
                  {Object.entries({
                    label: row.label,
                    budget: row.budget,
                    cost: row.cost,
                    remaining: row.remaining,
                  }).map(([key, value]) => (
                    <td className={cell} key={key}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </ManagementTable>
          )}
        </section>
      )}
      {tab !== "overview" && (
        <section className="lab-workbench-panel space-y-3">
          <header className="lab-workbench-panel-head">
            <h2>{tab === "cost" ? "工时与执行成本" : tab === "payroll" ? "项目工资单" : "财务审计"}</h2>
            <div className="flex flex-wrap gap-2">
              {!data.closed && tab === "cost" && (
                <Button size="sm" onClick={() => setChosen({ kind: "cost", action: "save" })}>
                  登记工时／费用
                </Button>
              )}
              {!data.closed && tab === "payroll" && (
                <>
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    onClick={() => {
                      setTab("cost");
                      setChosen({ kind: "cost", action: "save", reimbursement: true });
                    }}
                  >
                    申请报销
                  </Button>
                  {data.can_approve && (
                    <Button size="sm" onClick={() => setChosen({ kind: "payroll", action: "save" })}>
                      生成工资单
                    </Button>
                  )}
                </>
              )}
              {tab === "audit" && data.can_audit && (
                <Button size="sm" onClick={() => setChosen({ kind: "audit", action: "save" })}>
                  新增审计调整
                </Button>
              )}
              {tab === "audit" && data.can_recover && (
                <Button
                  size="sm"
                  variant="neutral-primary"
                  onClick={() => setChosen({ kind: "recovery", action: "save" })}
                >
                  登记审计追回
                </Button>
              )}
            </div>
          </header>
          {records.length ? (
            <ManagementTable
              headings={
                tab === "cost"
                  ? ["日期／成员", "类别与事项", "计算明细", "费用／认定金额（元）", "状态", "操作"]
                  : tab === "payroll"
                    ? ["成员／期间", "工作明细", "工时", "工资金额（元）", "状态", "操作"]
                    : ["审计问题", "关联成本", "调整前（元）", "认定金额／差额（元）", "依据", "操作"]
              }
            >
              {records.map((row) => (
                <tr key={row.id}>
                  {tab === "cost" ? (
                    <>
                      <td className={cell}>
                        {row.data.date}
                        {row.data.end_date && row.data.end_date !== row.data.date && <> 至 {row.data.end_date}</>}
                        <br />
                        {row.data.user_name}
                        {row.data.team_name && <p>{row.data.team_name}</p>}
                      </td>
                      <td className={cell}>
                        {costCategories.find((entry) => entry.value === row.data.category)?.label}
                        <p className="max-w-64 whitespace-pre-wrap">{row.data.work}</p>
                      </td>
                      <td className={cell}>
                        {row.data.category === "labor" ? (
                          `${row.data.hours} 小时 × ${row.data.rate} 元／小时`
                        ) : (
                          <>
                            <p>实际费用：{row.data.actual_amount}</p>
                            {row.data.category === "travel" && (
                              <>
                                <p>
                                  交通补助：{row.data.days} 天 × {row.data.transport_rate}
                                </p>
                                <p>
                                  餐费补助：{row.data.days} 天 × {row.data.meal_rate}
                                </p>
                              </>
                            )}
                          </>
                        )}
                      </td>
                      <td className={cell}>
                        {row.data.amount} / {row.recognized_amount}
                      </td>
                      <td className={cell}>
                        <StatusPill state={row.state} />
                        {row.payroll_id && <p>已计入工资单</p>}
                      </td>
                    </>
                  ) : tab === "payroll" ? (
                    <>
                      <td className={cell}>
                        {row.data.user_name}
                        <br />
                        {row.data.start} 至 {row.data.end}
                      </td>
                      <td className={cell}>
                        <details>
                          <summary>{row.data.lines?.length ?? 0} 条工作记录</summary>
                          {row.data.lines?.map((line) => (
                            <p className="max-w-64 whitespace-pre-wrap" key={line.cost_id}>
                              {line.date}
                              {line.end_date && line.end_date !== line.date ? ` 至 ${line.end_date}` : ""} · {line.work}{" "}
                              · {line.hours} 小时 × {line.rate} = {line.amount} 元
                            </p>
                          ))}
                        </details>
                      </td>
                      <td className={cell}>{row.data.hours}</td>
                      <td className={cell}>{row.data.amount}</td>
                      <td className={cell}>
                        <StatusPill state={row.state} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={`${cell} max-w-64 whitespace-pre-wrap`}>{row.data.finding}</td>
                      <td className={cell}>
                        {data.records.find((entry) => entry.id === row.data.cost_id)?.data.work ?? "原成本记录"}
                      </td>
                      <td className={cell}>{row.data.original_amount}</td>
                      <td className={cell}>
                        {row.data.allowed_amount}
                        <br />
                        {row.data.adjustment}
                      </td>
                      <td className={`${cell} max-w-64 break-words`}>{row.data.evidence}</td>
                    </>
                  )}
                  <td className={cell}>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="neutral-primary" onClick={() => setHistory(row)}>
                        历史
                      </Button>
                      {!data.closed &&
                        row.kind === "cost" &&
                        ["submitted", "rejected"].includes(row.state) &&
                        (data.can_record || row.data.user_id === data.user_id) && (
                          <>
                            <Button
                              size="sm"
                              variant="neutral-primary"
                              onClick={() => setChosen({ kind: "cost", action: "save", row })}
                            >
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="neutral-primary"
                              onClick={() => setChosen({ kind: "cost", action: "cancel", row })}
                            >
                              撤回
                            </Button>
                          </>
                        )}
                      {!data.closed && row.kind === "cost" && row.state === "submitted" && data.can_approve && (
                        <Button size="sm" onClick={() => setChosen({ kind: "cost", action: "review", row })}>
                          审核
                        </Button>
                      )}
                      {!data.closed && row.kind === "payroll" && row.state === "ready" && data.can_approve && (
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => setChosen({ kind: "payroll", action: "cancel", row })}
                        >
                          取消工资单
                        </Button>
                      )}
                      {!data.closed &&
                        data.can_pay &&
                        ((row.kind === "cost" && row.data.category !== "labor" && row.state === "approved") ||
                          (row.kind === "payroll" && row.state === "ready")) && (
                          <Button size="sm" onClick={() => setChosen({ kind: row.kind, action: "pay", row })}>
                            登记支付
                          </Button>
                        )}
                      {!data.closed && data.can_pay && row.state === "paid" && (
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => setChosen({ kind: row.kind, action: "reverse-payment", row })}
                        >
                          冲正支付
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </ManagementTable>
          ) : (
            <p className="text-13 text-secondary">暂无记录</p>
          )}
        </section>
      )}
      {tab === "payroll" && (
        <section className="lab-workbench-panel space-y-3">
          <header className="lab-workbench-panel-head">
            <h2>项目报销</h2>
          </header>
          <ManagementTable headings={["日期／成员", "报销事项", "金额（元）", "状态", "操作"]}>
            {data.records
              .filter((row) => row.kind === "cost" && row.data.category !== "labor")
              .map((row) => (
                <tr key={row.id}>
                  <td className={cell}>
                    {row.data.date} · {row.data.user_name}
                  </td>
                  <td className={cell}>{row.data.work}</td>
                  <td className={cell}>{row.recognized_amount}</td>
                  <td className={cell}>
                    <StatusPill state={row.state} />
                  </td>
                  <td className={cell}>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="neutral-primary" onClick={() => setHistory(row)}>
                        历史
                      </Button>
                      {!data.closed && data.can_approve && row.state === "submitted" && (
                        <Button size="sm" onClick={() => setChosen({ kind: "cost", action: "review", row })}>
                          审核
                        </Button>
                      )}
                      {!data.closed && data.can_pay && row.state === "approved" && (
                        <Button size="sm" onClick={() => setChosen({ kind: "cost", action: "pay", row })}>
                          登记支付
                        </Button>
                      )}
                      {!data.closed && data.can_pay && row.state === "paid" && (
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => setChosen({ kind: "cost", action: "reverse-payment", row })}
                        >
                          冲正支付
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </ManagementTable>
        </section>
      )}
      {tab === "audit" && (
        <section className="lab-workbench-panel space-y-3">
          <header className="lab-workbench-panel-head">
            <h2>追回记录</h2>
          </header>
          <ManagementTable headings={["成员／事项", "追回金额（元）", "收款流水号", "状态", "操作"]}>
            {data.records
              .filter((row) => row.kind === "recovery")
              .map((row) => (
                <tr key={row.id}>
                  <td className={cell}>
                    {row.data.user_name} · {row.data.work}
                  </td>
                  <td className={cell}>{row.data.amount}</td>
                  <td className={cell}>{row.data.reference}</td>
                  <td className={cell}>
                    <StatusPill state={row.state} />
                  </td>
                  <td className={cell}>
                    <div className="flex gap-1">
                      <Button size="sm" variant="neutral-primary" onClick={() => setHistory(row)}>
                        历史
                      </Button>
                      {data.can_recover && row.state === "received" && (
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => setChosen({ kind: "recovery", action: "reverse-recovery", row })}
                        >
                          冲正追回
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </ManagementTable>
        </section>
      )}
    </section>
  );
}
