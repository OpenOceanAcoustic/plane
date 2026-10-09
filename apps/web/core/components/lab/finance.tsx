/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import type { LabStore } from "@plane/shared-state";
import type { LabBountyBudget, LabFinanceOverview } from "@plane/types";
import { Button, labDecimalText, labDecimalUnits, labInputClass } from "@plane/ui";
import { LabFinanceDeleteDialog } from "./finance-delete";
import type { LabFinanceDeletion } from "./finance-delete";
import { LabFinanceActionDialog, accountKindLabels, financeActionLabels } from "./finance-form";
import type { LabFinanceChosenAction } from "./finance-form";
import { LabForecastDialog, LabFormulaEditor } from "./finance-formula";
import { LabLedger } from "./ledger";
import { LabRecordWorkflowView } from "./record-workflow";
// oxlint-disable-next-line import/no-unassigned-import -- local financial and task surfaces
import "./finance-market.css";

function Money({ amount }: { amount: string | null | undefined }) {
  return (
    <span className="lab-finance-money font-mono whitespace-nowrap">
      {amount === null || amount === undefined ? "—" : `¥${amount}`}
    </span>
  );
}
function Records<T extends { id: string }>({
  rows,
  columns,
  empty = "暂无记录",
}: {
  rows: T[];
  columns: { label: string; cell: (row: T) => ReactNode }[];
  empty?: string;
}) {
  if (!rows.length)
    return <p className="rounded border border-dashed border-subtle p-6 text-center text-13 text-secondary">{empty}</p>;
  return (
    <div className="lab-finance-table overflow-x-auto rounded-lg border border-subtle">
      <table className="w-full text-left text-12">
        <thead className="bg-layer-1">
          <tr>
            {columns.map((column) => (
              <th key={column.label} className="px-3 py-2 font-medium whitespace-nowrap">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-subtle">
              {columns.map((column) => (
                <td key={column.label} className="max-w-xs px-3 py-2 align-top break-words">
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const stamp = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const totalMoney = (amounts: string[]) =>
  labDecimalText(amounts.reduce((sum, value) => sum + (labDecimalUnits(value) ?? 0n), 0n));

export const LabFinance = observer(function LabFinance({
  store,
  refreshKey = 0,
}: {
  store: LabStore;
  refreshKey?: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("project_id") ?? "";
  const setProjectId = (id: string) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("project_id", id);
      else next.delete("project_id");
      return next;
    });
  const [tab, setTab] = useState("accounts");
  const [chosen, setChosen] = useState<LabFinanceChosenAction>();
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [deletion, setDeletion] = useState<LabFinanceDeletion>();
  const [showDeleted, setShowDeleted] = useState(false);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const [revision, setRevision] = useState(0);
  const { data, error, isLoading, mutate } = useSWR(["lab-finance", store.slug, projectId, refreshKey], () =>
    store.request<LabFinanceOverview>(
      `finance/overview/${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`
    )
  );
  const {
    data: budgets,
    error: budgetError,
    mutate: mutateBudgets,
  } = useSWR(["lab-project-vc-budgets", store.slug, refreshKey], () =>
    store.request<LabBountyBudget[]>("bounties/budgets/")
  );
  const visibleBudgets =
    budgets?.filter((budget) => (!projectId || budget.project_id === projectId) && (showDeleted || !budget.deleted)) ??
    [];
  useEffect(() => {
    void store.execute(store.loadMarket);
  }, [store]);
  const onSaved = async () => {
    await Promise.all([mutate(), mutateBudgets()]);
    setRevision((value) => value + 1);
  };
  const selectedProject = data?.projects.find((project) => project.id === projectId);
  const removedScope = (project: string | null, stage: string | null) =>
    data?.projects.some((row) => row.id === project && row.deleted) ||
    data?.stages.some((row) => row.stage_id === stage && row.deleted);
  const activeBatches = data?.batches.filter((batch) => !batch.reversed && batch.kind !== "opening") ?? [];
  const receiptTotals = {
    gross: totalMoney(activeBatches.map((batch) => batch.gross)),
    D: totalMoney(activeBatches.map((batch) => batch.D)),
  };
  const lead = Boolean(selectedProject?.is_lead && !selectedProject.deleted);
  const canManage = projectId
    ? lead
    : Boolean(data?.is_manager || data?.projects.some((project) => project.is_lead && !project.deleted));
  const memberName = (id: string) => data?.members.find((member) => member.id === id)?.name ?? "本人／历史成员";
  const stageName = (id: string) => data?.stages.find((stage) => stage.stage_id === id)?.name ?? "阶段";
  const accountName = (id: string) => data?.accounts.find((account) => account.id === id)?.label ?? "资金账户";
  const open = (action: string, body?: Record<string, string>) => setChosen({ action, body });
  const managementActions = [
    "stage",
    "receipt",
    "opening",
    "transfer",
    "expense",
    "settlement",
    "history-settlement",
    "commit",
    "cancel-commit",
    "payment",
    "tax-remit",
    "risk-release",
    "risk-use",
    "dispute",
    "resolve-dispute",
    "carryover",
    "stage-allocation",
    "reverse",
    ...(data?.is_manager
      ? [
          "future-plan",
          "exploration-allocation",
          "public-duty",
          "public-commit",
          "public-cancel-commit",
          "public-payment",
        ]
      : []),
  ];
  return (
    <div className="lab-finance space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="资金项目"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setChosen(undefined);
            setDeletion(undefined);
            setFormulaOpen(false);
            setForecastOpen(false);
          }}
          className={`${labInputClass} max-w-72`}
        >
          <option value="">全部可见资金与公共池</option>
          {(
            data?.projects.filter((project) => showDeleted || !project.deleted) ??
            store.planner?.projects.map((project) => ({ ...project, is_lead: project.lead })) ??
            []
          ).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
              {"deleted" in project && project.deleted ? " · 已删除" : project.is_lead ? " · 负责人" : ""}
            </option>
          ))}
        </select>
        {(projectId ? lead : data?.projects.some((project) => project.is_lead && !project.deleted)) && (
          <Button variant="primary" size="sm" onClick={() => open("vc-stage")}>
            设置 VC 预算
          </Button>
        )}
        {lead && (
          <Button variant="neutral-primary" size="sm" onClick={() => setFormulaOpen(true)}>
            项目奖励公式
          </Button>
        )}
        {selectedProject?.is_lead && !selectedProject.deleted && (
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              setDeletion({
                kind: "project",
                id: selectedProject.id,
                name: selectedProject.name,
                blockedReason: selectedProject.delete_reason ?? undefined,
              })
            }
          >
            删除资金项目
          </Button>
        )}
        {selectedProject?.is_lead && selectedProject.deleted && (
          <Button
            size="sm"
            variant="neutral-primary"
            onClick={() => open("project-restore", { project_id: selectedProject.id })}
          >
            恢复资金项目
          </Button>
        )}
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={!data?.stages.some((stage) => !stage.deleted)}
          onClick={() => setForecastOpen(true)}
        >
          新增参考预测
        </Button>
        {canManage && (
          <select
            aria-label="办理资金事项"
            className={`${labInputClass} max-w-64`}
            value=""
            onChange={(event) => {
              if (event.target.value) open(event.target.value);
            }}
          >
            <option value="">办理资金事项…</option>
            {managementActions.map((action) => (
              <option key={action} value={action}>
                {financeActionLabels[action]}
              </option>
            ))}
          </select>
        )}
        {(data?.is_manager || data?.can_designate_manager) && (
          <Button size="sm" variant="neutral-primary" onClick={() => open("manager")}>
            指定公共池管理员
          </Button>
        )}
      </div>
      {!!visibleBudgets.length && (
        <section aria-label="项目 VC 预算" className="space-y-2">
          <h2 className="text-14 font-semibold">项目 VC 预算</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleBudgets.map((budget) => (
              <article
                key={budget.project_id}
                data-tone="purple"
                className="lab-finance-card lab-finance-vc rounded-lg border border-subtle bg-layer-2 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-14 font-medium">{budget.project}</h3>
                  {budget.deleted && <span className="text-13 text-secondary">已删除</span>}
                  {budget.stage_id && !budget.deleted && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        setDeletion({
                          kind: "stage",
                          id: budget.stage_id!,
                          name: budget.stage_name ?? "VC 预算",
                          blockedReason: budget.delete_reason ?? undefined,
                        })
                      }
                    >
                      删除阶段预算
                    </Button>
                  )}
                  {budget.stage_id && budget.can_restore && (
                    <Button
                      size="sm"
                      variant="neutral-primary"
                      onClick={() => open("stage-restore", { stage_id: budget.stage_id! })}
                    >
                      恢复阶段预算
                    </Button>
                  )}
                </div>
                {budget.configured ? (
                  <>
                    <p className="mt-1 text-13">{budget.stage_name}</p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-13">
                      <div>
                        <dt className="text-secondary">预算</dt>
                        <dd className="lab-finance-figure">{budget.budget} VC</dd>
                      </div>
                      <div>
                        <dt className="text-secondary">已占用</dt>
                        <dd className="lab-finance-figure lab-finance-reserved">{budget.reserved} VC</dd>
                      </div>
                      <div>
                        <dt className="text-secondary">剩余</dt>
                        <dd className="lab-finance-figure lab-finance-available">{budget.available} VC</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="mt-2 text-13 text-secondary">尚未设置 VC 预算</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {budgetError && (
        <p role="alert" className="text-13 text-danger-primary">
          {budgetError instanceof Error ? budgetError.message : "项目 VC 预算加载失败"}
        </p>
      )}
      <nav aria-label="资金账视图" className="lab-finance-tabs flex flex-wrap gap-2">
        {[
          { id: "accounts", label: "真实余额与到账" },
          { id: "forecasts", label: "预算与参考预测" },
          { id: "settlements", label: "核准与付款" },
          { id: "ledger", label: "账目明细" },
          { id: "vc-ledger", label: "VC 明细" },
          { id: "workflow", label: "资金与项目流程" },
        ].map((view) => (
          <Button
            key={view.id}
            size="sm"
            variant={tab === view.id ? "accent-primary" : "neutral-primary"}
            aria-pressed={tab === view.id}
            onClick={() => setTab(view.id)}
          >
            {view.label}
          </Button>
        ))}
      </nav>
      <label className="flex items-center gap-2 text-13">
        <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
        显示已删除记录
      </label>
      {isLoading && <p className="text-13 text-secondary">正在读取资金账…</p>}
      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          {error instanceof Error ? error.message : "资金账加载失败"}
        </p>
      )}
      {data && tab === "accounts" && (
        <>
          {!!data.public_summary?.length && (
            <section aria-label="实验室公共资金汇总" className="space-y-2">
              <h2 className="text-14 font-semibold">实验室公共资金池</h2>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {data.public_summary.map((account) => (
                  <article
                    key={account.kind}
                    data-account-kind={account.kind}
                    className="lab-finance-card lab-public-pool-card rounded-lg border border-subtle bg-layer-2 p-4"
                  >
                    <h3 className="text-13">{account.label || accountKindLabels[account.kind]}</h3>
                    <p className="lab-finance-figure mt-2 text-18">
                      <Money amount={account.balance} />
                    </p>
                    <p className="mt-1 text-12 text-secondary">
                      已承诺 <Money amount={account.committed} /> · 可承诺 <Money amount={account.available} />
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}
          <section aria-label="可见账户明细" className="space-y-2">
            <h2 className="text-14 font-semibold">资金账户实际余额</h2>
            <Records
              rows={data.accounts.filter(
                (account) => showDeleted || !removedScope(account.project_id, account.stage_id)
              )}
              empty="暂无可见资金账户。"
              columns={[
                { label: "账户", cell: (row) => row.label },
                {
                  label: "资金类型",
                  cell: (row) => (
                    <span className="lab-finance-kind" data-account-kind={row.kind}>
                      {accountKindLabels[row.kind] ?? row.kind}
                    </span>
                  ),
                },
                { label: "实际余额", cell: (row) => <Money amount={row.balance} /> },
                { label: "已承诺", cell: (row) => <Money amount={row.committed} /> },
                {
                  label: "可承诺余额",
                  cell: (row) => (
                    <span className="lab-finance-available">
                      <Money amount={row.available} />
                    </span>
                  ),
                },
                {
                  label: "办理",
                  cell: (row) =>
                    row.can_manage ? (
                      <Button
                        size="sm"
                        variant="neutral-primary"
                        onClick={() =>
                          open(
                            row.kind === "execution"
                              ? "dispute"
                              : row.kind === "withholding"
                                ? "tax-remit"
                                : row.kind === "retained"
                                  ? "stage-allocation"
                                  : "expense",
                            { account_id: row.id, from_account_id: row.id }
                          )
                        }
                      >
                        {row.kind === "execution"
                          ? "争议预留"
                          : row.kind === "withholding"
                            ? "扣缴上缴"
                            : row.kind === "retained"
                              ? "拨付新阶段奖励"
                              : "登记支出"}
                      </Button>
                    ) : (
                      "只读"
                    ),
                },
              ]}
            />
          </section>
          <section aria-label="真实到账批次" className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto text-14 font-semibold">实际到账与准备金明细</h2>
              {data.stages.some((stage) => stage.can_manage && !stage.deleted) && (
                <Button size="sm" variant="primary" onClick={() => open("receipt")}>
                  登记一笔到账
                </Button>
              )}
            </div>
            <dl aria-label="到账汇总" className="flex flex-wrap gap-5 text-13">
              <div>
                <dt className="text-secondary">到账笔数</dt>
                <dd>{activeBatches.length} 笔</dd>
              </div>
              <div>
                <dt className="text-secondary">累计到账</dt>
                <dd>
                  <Money amount={receiptTotals.gross} />
                </dd>
              </div>
              <div>
                <dt className="text-secondary">累计核准 D</dt>
                <dd>
                  <Money amount={receiptTotals.D} />
                </dd>
              </div>
            </dl>
            <Records
              rows={data.batches.filter((batch) => showDeleted || !batch.reversed)}
              columns={[
                {
                  label: "到账来源／阶段",
                  cell: (row) => (
                    <>
                      {row.source}
                      <p className="text-secondary">
                        {stageName(row.stage_id)} · {stamp(row.occurred_at ?? row.created_at)}
                      </p>
                      {row.reversed && <span className="text-secondary">已删除</span>}
                    </>
                  ),
                },
                { label: "本次到账", cell: (row) => <Money amount={row.gross} /> },
                { label: "成本", cell: (row) => <Money amount={row.costs} /> },
                { label: "核准 D", cell: (row) => <Money amount={row.D} /> },
                { label: "执行奖励", cell: (row) => <Money amount={row.execution} /> },
                { label: "历史奖励", cell: (row) => <Money amount={row.history} /> },
                {
                  label: "风险金／尚未释放",
                  cell: (row) => (
                    <>
                      <Money amount={row.risk} />／<Money amount={row.risk_remaining} />
                    </>
                  ),
                },
                {
                  label: "办理",
                  cell: (row) =>
                    row.can_manage && !row.reversed ? (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => open("risk-release", { batch_id: row.id })}
                        >
                          释放原批次风险金
                        </Button>
                        {row.kind !== "opening" && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() =>
                              setDeletion({
                                kind: "receipt",
                                id: row.id,
                                name: row.source,
                                amount: row.gross,
                                blockedReason: row.delete_reason ?? undefined,
                              })
                            }
                          >
                            删除到账记录
                          </Button>
                        )}
                      </div>
                    ) : (
                      "只读"
                    ),
                },
              ]}
            />
          </section>
        </>
      )}
      {data && tab === "forecasts" && (
        <>
          <section aria-label="冻结阶段预算" className="space-y-3">
            <h2 className="text-14 font-semibold">负责人事前阶段预算</h2>
            {!data.stages.length && <p className="text-13 text-secondary">暂无阶段预算。</p>}
            {data.stages
              .filter((stage) => showDeleted || !stage.deleted)
              .map((stage) => (
                <article
                  key={stage.id}
                  data-tone="indigo"
                  className="lab-finance-card lab-finance-stage rounded-lg border border-subtle p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="mr-auto text-14 font-semibold">{stage.name}</h3>
                    {stage.deleted && <span className="text-13 text-secondary">已删除</span>}
                    <span className="text-13">
                      预测预算 <Money amount={stage.E} /> · VC 预算 {stage.B} VC
                    </span>
                    <span className="text-12 text-secondary">
                      公式 {stage.formula_version ? `v${stage.formula_version}` : "尚未配置"}
                    </span>
                    {stage.can_manage && !stage.deleted && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          setDeletion({
                            kind: "stage",
                            id: stage.stage_id,
                            name: stage.name,
                            amount: stage.E,
                            blockedReason: stage.delete_reason ?? undefined,
                          })
                        }
                      >
                        删除阶段预算
                      </Button>
                    )}
                    {stage.can_restore && stage.deleted && (
                      <Button
                        size="sm"
                        variant="neutral-primary"
                        onClick={() => open("stage-restore", { stage_id: stage.stage_id })}
                      >
                        恢复阶段预算
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-12 text-secondary">
                    实际执行奖励额度 <Money amount={stage.execution_funded} /> · 历史奖励额度{" "}
                    <Money amount={stage.history_funded} />
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2 text-12">
                    {stage.purposes.map((purpose) => (
                      <li
                        key={`${purpose.name}-${purpose.amount}`}
                        className="lab-finance-purpose rounded bg-layer-1 px-2 py-1"
                      >
                        {purpose.name} · <Money amount={purpose.amount} />
                      </li>
                    ))}
                  </ul>
                  <details className="mt-2 text-12">
                    <summary className="cursor-pointer">查看冻结成员与历史资格</summary>
                    {stage.members.map((member) => (
                      <p key={member.user_id} className="mt-1">
                        {memberName(member.user_id)}：b {member.b} · r {member.r} · 计划 {member.planned_vc} VC
                      </p>
                    ))}
                    {stage.history.map((member) => (
                      <p key={member.user_id} className="mt-1">
                        历史资格 {memberName(member.user_id)}：份额 {member.share} · {member.qualified_at} ·{" "}
                        {member.basis}
                      </p>
                    ))}
                  </details>
                </article>
              ))}
          </section>
          <section aria-label="已保存预测快照" className="space-y-2">
            <h2 className="text-14 font-semibold">参考预测及公式快照</h2>
            <Records
              rows={data.forecasts}
              columns={[
                {
                  label: "对象",
                  cell: (row) =>
                    row.kind === "member"
                      ? memberName(row.user_id ?? "")
                      : (store.bounties.find((bounty) => bounty.id === row.bounty_id)?.title ?? "悬赏任务"),
                },
                {
                  label: "阶段／口径",
                  cell: (row) => (
                    <>
                      {stageName(row.stage_id)} · {row.basis === "budget" ? "预算预测" : "到账测算"}
                    </>
                  ),
                },
                { label: "预计奖励", cell: (row) => <Money amount={row.result} /> },
                {
                  label: "公式版本",
                  cell: (row) => (
                    <details>
                      <summary className="cursor-pointer">v{row.formula_version}</summary>
                      <code className="block break-words">{row.expression}</code>
                      <dl>
                        {Object.entries(row.inputs).map(([name, value]) => (
                          <div key={name}>
                            {name} = {value}
                          </div>
                        ))}
                      </dl>
                    </details>
                  ),
                },
                { label: "快照时间", cell: (row) => stamp(row.created_at) },
              ]}
            />
          </section>
        </>
      )}
      {data && tab === "settlements" && (
        <>
          <section aria-label="公共职责奖励明细" className="space-y-2">
            <h2 className="text-14 font-semibold">公共职责月度固定奖励</h2>
            <Records
              rows={data.public_awards ?? []}
              columns={[
                {
                  label: "成员／月份",
                  cell: (row) => (
                    <>
                      {row.user_name} · {row.period}
                      <p className="text-secondary">修订 {row.revision}</p>
                    </>
                  ),
                },
                { label: "职责与履职依据", cell: (row) => row.duty },
                { label: "累计核准", cell: (row) => <Money amount={row.amount} /> },
                {
                  label: "已核销／扣缴／实付",
                  cell: (row) => (
                    <>
                      <Money amount={row.paid} />／<Money amount={row.withheld} />／<Money amount={row.net_paid} />
                    </>
                  ),
                },
                {
                  label: "待付／已安排",
                  cell: (row) => (
                    <>
                      <Money amount={row.outstanding} />／<Money amount={row.committed} />
                    </>
                  ),
                },
                {
                  label: "办理",
                  cell: (row) =>
                    row.can_manage ? (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => open("public-commit", { award_id: row.id })}>
                          安排公共职责支付
                        </Button>
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() =>
                            open("public-duty", {
                              award_id: row.id,
                              user_id: row.user_id,
                              period: row.period,
                              amount: row.amount,
                              duty: row.duty,
                            })
                          }
                        >
                          追加修订
                        </Button>
                      </div>
                    ) : (
                      "只读"
                    ),
                },
              ]}
            />
          </section>
          <section aria-label="公共职责支付安排" className="space-y-2">
            <h2 className="text-14 font-semibold">公共职责现金承诺</h2>
            <Records
              rows={data.public_commitments ?? []}
              columns={[
                { label: "成员", cell: (row) => row.user_name },
                { label: "安排金额", cell: (row) => <Money amount={row.amount} /> },
                {
                  label: "已核销／未付安排",
                  cell: (row) => (
                    <>
                      <Money amount={row.paid} />／<Money amount={row.remaining} />
                    </>
                  ),
                },
                { label: "状态", cell: (row) => (row.cancelled ? "已取消未付" : "已承诺") },
                {
                  label: "办理",
                  cell: (row) =>
                    row.can_manage && !row.cancelled ? (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => open("public-payment", { commitment_id: row.id })}>
                          登记公共职责支付
                        </Button>
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => open("public-cancel-commit", { commitment_id: row.id })}
                        >
                          取消未付安排
                        </Button>
                      </div>
                    ) : (
                      "只读"
                    ),
                },
              ]}
            />
          </section>
          <section aria-label="公共职责线下支付记录" className="space-y-2">
            <h2 className="text-14 font-semibold">公共职责实付与扣缴</h2>
            <Records
              rows={data.public_payments ?? []}
              columns={[
                { label: "成员", cell: (row) => memberName(row.user_id) },
                {
                  label: "核销应付／扣缴／实付",
                  cell: (row) => (
                    <>
                      <Money amount={row.gross} />／<Money amount={row.withheld} />／<Money amount={row.net} />
                    </>
                  ),
                },
                {
                  label: "付款依据",
                  cell: (row) => (
                    <>
                      {row.reference}
                      <p>{row.evidence}</p>
                    </>
                  ),
                },
                {
                  label: "事实／登记时间",
                  cell: (row) => (
                    <>
                      {stamp(row.occurred_at)}
                      <p className="text-secondary">
                        登记 {stamp(row.created_at)}
                        {row.reversed ? " · 已冲正" : ""}
                      </p>
                    </>
                  ),
                },
              ]}
            />
          </section>

          <section aria-label="最终核准与预测差异" className="space-y-2">
            <h2 className="text-14 font-semibold">累计最终核准与参考差异</h2>
            <Records
              rows={data.settlements}
              columns={[
                {
                  label: "成员／阶段",
                  cell: (row) => (
                    <>
                      {row.user_name}
                      <p className="text-secondary">
                        {stageName(row.stage_id)} · {row.kind === "history" ? "历史资格" : "执行奖励"} · 修订{" "}
                        {row.revision}
                      </p>
                    </>
                  ),
                },
                { label: "参考预测", cell: (row) => <Money amount={row.forecast_amount} /> },
                { label: "累计核准", cell: (row) => <Money amount={row.amount} /> },
                { label: "与参考差异", cell: (row) => <Money amount={row.difference} /> },
                { label: "已核销", cell: (row) => <Money amount={row.paid} /> },
                {
                  label: "扣缴／实付",
                  cell: (row) => (
                    <>
                      <Money amount={row.withheld} />／<Money amount={row.net_paid} />
                    </>
                  ),
                },
                {
                  label: "待付／已安排",
                  cell: (row) => (
                    <>
                      <Money amount={row.outstanding} />／<Money amount={row.committed} />
                    </>
                  ),
                },
                { label: "绩效依据", cell: (row) => row.performance_basis },
                {
                  label: "办理",
                  cell: (row) =>
                    row.can_manage ? (
                      <div className="flex flex-col gap-1">
                        <Button size="sm" onClick={() => open("commit", { settlement_id: row.id })}>
                          安排支付
                        </Button>
                        {row.kind === "execution" && (
                          <Button
                            size="sm"
                            variant="neutral-primary"
                            onClick={() =>
                              open("settlement", { stage_id: row.stage_id, user_id: row.user_id, amount: row.amount })
                            }
                          >
                            追加核准修订
                          </Button>
                        )}
                      </div>
                    ) : (
                      "只读"
                    ),
                },
              ]}
            />
          </section>
          <section aria-label="现金支付安排" className="space-y-2">
            <h2 className="text-14 font-semibold">现金承诺与支付安排</h2>
            <Records
              rows={data.commitments}
              columns={[
                { label: "成员", cell: (row) => memberName(row.user_id) },
                { label: "安排金额", cell: (row) => <Money amount={row.amount} /> },
                { label: "已核销", cell: (row) => <Money amount={row.paid} /> },
                { label: "未付安排", cell: (row) => <Money amount={row.remaining} /> },
                { label: "状态", cell: (row) => (row.cancelled ? "已取消未付部分" : "已占用可承诺余额") },
                {
                  label: "办理",
                  cell: (row) =>
                    row.can_manage && !row.cancelled ? (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => open("payment", { commitment_id: row.id })}>
                          登记线下支付
                        </Button>
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => open("cancel-commit", { commitment_id: row.id })}
                        >
                          取消未付
                        </Button>
                      </div>
                    ) : (
                      "只读"
                    ),
                },
              ]}
            />
          </section>
          <section aria-label="线下付款记录" className="space-y-2">
            <h2 className="text-14 font-semibold">线下付款与扣缴记录</h2>
            <Records
              rows={data.payments}
              columns={[
                { label: "成员", cell: (row) => memberName(row.user_id) },
                { label: "核销应付", cell: (row) => <Money amount={row.gross} /> },
                { label: "扣缴", cell: (row) => <Money amount={row.withheld} /> },
                { label: "实际支付", cell: (row) => <Money amount={row.net} /> },
                {
                  label: "付款依据",
                  cell: (row) => (
                    <>
                      {row.reference}
                      <p>{row.evidence}</p>
                    </>
                  ),
                },
                {
                  label: "事实／登记时间",
                  cell: (row) => (
                    <>
                      {stamp(row.occurred_at)}
                      <p className="text-secondary">
                        登记 {stamp(row.created_at)}
                        {row.reversed ? " · 已冲正" : ""}
                      </p>
                    </>
                  ),
                },
              ]}
            />
          </section>
        </>
      )}
      {data && tab === "ledger" && (
        <>
          <div className="flex gap-4 text-13">
            <a
              className="text-accent-primary"
              href={`${store.apiBase}/api/workspaces/${encodeURIComponent(store.slug)}/lab/finance/entries/?format=csv${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`}
            >
              导出可见资金账 CSV
            </a>
            <a
              className="text-accent-primary"
              target="_blank"
              rel="noreferrer"
              href={`${store.apiBase}/api/workspaces/${encodeURIComponent(store.slug)}/lab/finance/entries/${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`}
            >
              查看可见资金账 JSON
            </a>
          </div>
          <Records
            rows={data.entries}
            columns={[
              {
                label: "账户／操作",
                cell: (row) => (
                  <>
                    {accountName(row.account_id)}
                    <p className="text-secondary">{financeActionLabels[row.kind] ?? row.kind}</p>
                  </>
                ),
              },
              { label: "变动（元）", cell: (row) => <Money amount={row.delta} /> },
              {
                label: "依据／凭证",
                cell: (row) => (
                  <>
                    {row.reason}
                    <p className="mt-1 text-secondary">{row.evidence}</p>
                    {row.reverses_id && <span>冲正原记录 {row.reverses_id}</span>}
                  </>
                ),
              },
              { label: "操作者", cell: (row) => row.actor },
              {
                label: "事实／登记时间",
                cell: (row) => (
                  <>
                    {stamp(row.occurred_at)}
                    <p className="text-secondary">登记 {stamp(row.created_at)}</p>
                  </>
                ),
              },
            ]}
          />
          <details className="text-13">
            <summary className="cursor-pointer">操作依据与追加更正</summary>
            <div className="mt-3">
              <Records
                rows={data.operations}
                columns={[
                  { label: "操作", cell: (row) => financeActionLabels[row.kind] ?? row.kind },
                  { label: "依据", cell: (row) => row.reason },
                  {
                    label: "操作者／时间",
                    cell: (row) => (
                      <>
                        {row.actor} · {stamp(row.created_at)}
                      </>
                    ),
                  },
                  {
                    label: "状态",
                    cell: (row) => (row.reversed ? "已追加冲正" : row.reverses_id ? "冲正记录" : "有效"),
                  },
                  {
                    label: "办理",
                    cell: (row) =>
                      row.can_manage && !row.reversed && !row.reverses_id ? (
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          onClick={() => open("reverse", { operation_id: row.id })}
                        >
                          追加冲正
                        </Button>
                      ) : (
                        "—"
                      ),
                  },
                ]}
              />
            </div>
          </details>
        </>
      )}
      {tab === "vc-ledger" && (
        <>
          <div className="flex gap-4 text-13">
            <a
              className="text-accent-primary"
              href={`${store.apiBase}/api/workspaces/${encodeURIComponent(store.slug)}/lab/ledger/?format=csv${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`}
            >
              导出项目 VC CSV
            </a>
            <a
              className="text-accent-primary"
              target="_blank"
              rel="noreferrer"
              href={`${store.apiBase}/api/workspaces/${encodeURIComponent(store.slug)}/lab/ledger/${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`}
            >
              查看 VC JSON 与冲正记录
            </a>
          </div>
          <LabLedger key={projectId} store={store} projectId={projectId} onSaved={onSaved} />
        </>
      )}
      {data && tab === "workflow" && (
        <>
          <LabRecordWorkflowView
            store={store}
            projectId={projectId}
            scope="finance"
            revision={revision}
            onAction={(action) => {
              if (action.action === "formula") setFormulaOpen(true);
              else if (action.action === "forecast") setForecastOpen(true);
              else open(action.action, action.body);
            }}
          />
          {projectId && (
            <LabRecordWorkflowView
              store={store}
              projectId={projectId}
              scope="project"
              revision={revision}
              onAction={(action) => {
                if (action.action === "formula") setFormulaOpen(true);
                else if (action.action === "forecast") setForecastOpen(true);
                else if (financeActionLabels[action.action]) open(action.action, action.body);
                else window.location.assign(`/${encodeURIComponent(store.slug)}/lab/bounties`);
              }}
            />
          )}
        </>
      )}
      {data && chosen && (
        <LabFinanceActionDialog
          key={`${chosen.action}-${chosen.body ? JSON.stringify(chosen.body) : ""}`}
          store={store}
          data={data}
          projectId={projectId}
          chosen={chosen}
          onClose={() => setChosen(undefined)}
          onSaved={onSaved}
        />
      )}
      {deletion && (
        <LabFinanceDeleteDialog
          key={`${deletion.kind}-${deletion.id}`}
          store={store}
          target={deletion}
          onClose={() => setDeletion((current) => (current === deletion ? undefined : current))}
          onSaved={async () => {
            await Promise.all([onSaved(), store.loadMarket()]);
            if (deletion.kind === "project" && currentProject.current === deletion.id) setProjectId("");
          }}
        />
      )}
      {formulaOpen && projectId && (
        <LabFormulaEditor store={store} projectId={projectId} onClose={() => setFormulaOpen(false)} onSaved={onSaved} />
      )}
      {data && forecastOpen && (
        <LabForecastDialog
          store={store}
          data={data}
          projectId={projectId}
          onClose={() => setForecastOpen(false)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
});
