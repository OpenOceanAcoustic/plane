/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { MobileSelect } from "../../components/select";
import { useState, useEffect } from "react";
import { PageHeading } from "../../components/ui";
import { CanonicalIcon } from "../../components/navigation";
import type { LabBountyBudget, LabFinanceOverview, LabRecordWorkflow, LabLedgerEntry } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { LabFinanceActionDialog, financeActionLabels, accountKindLabels } from "./finance-form";
import type { LabFinanceChosenAction } from "./finance-form";
import { LabFormulaEditor, LabForecastDialog } from "./finance-formula";
import { FinancePermissionDialog } from "./finance-permissions";
import { LabFinanceDeleteDialog } from "./finance-delete";
import type { LabFinanceDeletion } from "./finance-delete";
import {
  Button,
  LabDialog,
  LabField,
  ErrorMessage,
  Empty,
  KeyValues,
  labDecimalText,
  labDecimalUnits,
  LabDetail,
} from "./ui";
import { newRequestKey } from "./business";
const labels: Record<string, string> = {
  balance: "实际余额",
  committed: "已安排未付",
  available: "可用额度",
  name: "名称",
  label: "账户",
  kind: "类别",
  B: "冻结 VC 预算",
  E: "执行奖励预算",
  purposes: "预算用途",
  inputs: "公式输入快照",
  execution_funded: "执行实际资金",
  history_funded: "历史实际资金",
  formula_version: "公式版本",
  gross: "应付／到账",
  costs: "成本扣除",
  D: "可分配资金",
  source: "资金来源",
  risk: "风险金",
  execution: "执行奖励",
  history: "历史孵化奖励",
  risk_released: "已释放风险金",
  risk_used: "风险实际支出",
  risk_remaining: "风险金剩余",
  user_name: "成员",
  amount: "核准金额",
  performance_basis: "核准依据",
  paid: "累计已付",
  withheld: "扣缴",
  net_paid: "累计实付",
  outstanding: "尚待付款",
  difference: "与参考差额",
  forecast_amount: "参考预测",
  remaining: "未付安排",
  cancelled: "已取消",
  net: "实付",
  evidence: "凭证",
  reference: "线下凭证号",
  created_at: "登记时间",
  occurred_at: "事实发生时间",
  actor: "经办人",
  reason: "依据",
  result: "预测结果",
  basis: "计算口径",
  expression: "计算公式",
  delta: "资金变化",
  duty: "公共职责依据",
  period: "履职月份",
  earned: "累计获得",
  reversed: "已冲正",
  net_vc: "有效 VC",
  budget: "VC 预算",
  reserved: "已占用",
  planned_vc: "计划 VC",
  b: "基础份额",
  r: "职责份额",
};
const tabs = [
  { id: "accounts", name: "余额与到账" },
  { id: "stages", name: "预算与预测" },
  { id: "settlements", name: "核准与付款" },
  { id: "entries", name: "账目明细" },
  { id: "ledger", name: "VC 明细" },
  { id: "workflow", name: "资金与项目流程" },
];
const legacyTabs: Record<string, string> = {
  batches: "accounts",
  forecasts: "stages",
  commitments: "settlements",
  payments: "settlements",
  public_awards: "settlements",
  public_commitments: "settlements",
  public_payments: "settlements",
  operations: "entries",
};
const actionGroups = [
  { title: "预算与到账", actions: ["vc-stage", "stage", "receipt", "opening", "transfer", "expense"] },
  {
    title: "核准与支付",
    actions: ["settlement", "history-settlement", "commit", "cancel-commit", "payment", "tax-remit"],
  },
  {
    title: "准备金与结转",
    actions: ["risk-release", "risk-use", "stage-allocation", "dispute", "resolve-dispute", "carryover"],
  },
  {
    title: "公共资金",
    actions: [
      "future-plan",
      "exploration-allocation",
      "public-duty",
      "public-commit",
      "public-cancel-commit",
      "public-payment",
    ],
  },
  { title: "公式与参考预测", actions: ["formula", "forecast-task", "forecast-member"] },
  { title: "更正与恢复", actions: ["reverse", "stage-restore", "project-restore"] },
];
const sumAmount = (values: (string | null | undefined)[]) =>
  labDecimalText(values.reduce((total, value) => total + (value ? (labDecimalUnits(value) ?? 0n) : 0n), 0n));
export function Finance({
  store,
  onOpenIssue,
  initialTab = "accounts",
}: {
  store: LabStore;
  initialTab?: string;
  onOpenIssue?: (project: string, issue: string) => void;
}) {
  const [project, setProject] = useState("");
  const [tab, setTab] = useState(legacyTabs[initialTab] ?? initialTab);
  const [workflowScope, setWorkflowScope] = useState("finance");
  const [chosen, setChosen] = useState<LabFinanceChosenAction>();
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [formula, setFormula] = useState(false);
  const [forecast, setForecast] = useState<"task" | "member">();
  const [deletion, setDeletion] = useState<LabFinanceDeletion>();
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [ledgerReverse, setLedgerReverse] = useState<{ entry: LabLedgerEntry; key: string }>();
  const [deleted, setDeleted] = useState(false);
  const resource = useResource<LabFinanceOverview>(
    store,
    `finance/overview/${project ? `?project_id=${project}` : ""}`
  );
  const budgets = useResource<LabBountyBudget[]>(store, "bounties/budgets/");
  const flow = useResource<LabRecordWorkflow>(
    store,
    tab === "workflow"
      ? workflowScope === "project" && project
        ? `projects/${project}/workflow/`
        : `finance/workflow/${project ? `?project_id=${project}` : ""}`
      : null
  );
  const ledger = useResource<LabLedgerEntry[]>(
    store,
    ["accounts", "ledger"].includes(tab) ? `ledger/${project ? `?project_id=${project}` : ""}` : null
  );
  const data = resource.data;
  const loadMarket = store.loadMarket;
  useEffect(() => {
    loadMarket().catch(() => {});
  }, [loadMarket]);
  const refresh = async () => {
    await Promise.all([
      resource.refresh(),
      budgets.refresh(),
      store.loadMarket(),
      ...(tab === "workflow" ? [flow.refresh()] : []),
      ...(["accounts", "ledger"].includes(tab) ? [ledger.refresh()] : []),
    ]);
  };
  const open = (action: string, body?: Record<string, string>) => {
    setChosen({ action, body });
  };
  if (!data)
    return (
      <>
        <PageHeading title="资金与奖励" />
        <ErrorMessage error={resource.error} />
        <Empty>正在加载资金…</Empty>
      </>
    );
  const lead = project
    ? !!data.projects.find((row) => row.id === project && row.is_lead && !row.deleted)
    : data.projects.some((row) => row.is_lead && !row.deleted);
  const selectedProject = data.projects.find((row) => row.id === project);
  const canApprove = !!selectedProject?.permissions?.includes("approve");
  const manageable = !!data.allowed_actions?.length;
  const actions = new Set(data.allowed_actions ?? []);
  function recordValues(row: object) {
    return Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !!labels[key])
        .map(([key, value]) => [
          labels[key]!,
          key === "kind"
            ? (accountKindLabels[String(value)] ?? financeActionLabels[String(value)] ?? value)
            : typeof value === "boolean"
              ? value
                ? "是"
                : "否"
              : value,
        ])
    );
  }
  const overview = data;
  const currentBudgets = (budgets.data ?? []).filter(
    (row) => (!project || row.project_id === project) && (deleted || !row.deleted)
  );
  const activeBatches = overview.batches.filter((row) => !row.reversed && row.kind !== "opening");
  const executionAccounts = overview.accounts.filter((row) => row.kind === "execution");
  const deletable: LabFinanceDeletion[] = [
    ...overview.batches
      .filter((row) => row.can_delete)
      .map((row) => ({
        kind: "receipt" as const,
        id: row.id,
        name: row.source,
        amount: row.gross,
        blockedReason: row.delete_reason ?? undefined,
      })),
    ...overview.stages
      .filter((row) => row.can_delete)
      .map((row) => ({
        kind: "stage" as const,
        id: row.stage_id,
        name: row.name,
        blockedReason: row.delete_reason ?? undefined,
      })),
    ...currentBudgets
      .filter(
        (row) =>
          row.can_delete &&
          row.stage_id &&
          !overview.stages.some((stage) => stage.stage_id === row.stage_id && stage.can_delete)
      )
      .map((row) => ({
        kind: "stage" as const,
        id: row.stage_id!,
        name: row.stage_name ?? row.project,
        blockedReason: row.delete_reason ?? undefined,
      })),
    ...overview.projects
      .filter((row) => row.can_delete)
      .map((row) => ({
        kind: "project" as const,
        id: row.id,
        name: row.name,
        blockedReason: row.delete_reason ?? undefined,
      })),
  ];
  function recordSection(collection: keyof LabFinanceOverview, title: string) {
    const group = overview[collection];
    const records = Array.isArray(group) ? group.filter((row) => typeof row === "object" && row !== null) : [];
    return (
      <section className="lab-record-section">
        <div className="lab-section-heading">
          <h3>{title}</h3>
        </div>
        {records.map((row) => {
          const record = row as {
            id?: string;
            stage_id?: string;
            name?: string;
            label?: string;
            kind?: string;
            user_name?: string;
            source?: string;
            gross?: string;
            can_manage?: boolean;
            can_pay?: boolean;
            can_delete?: boolean;
            can_restore?: boolean;
            delete_reason?: string;
            deleted?: boolean;
            cancelled?: boolean;
            reversed?: boolean;
          };
          if (record.deleted && !deleted) return null;
          return (
            <article key={record.id ?? record.stage_id} className="lab-card">
              <h3>
                {record.name ??
                  record.source ??
                  record.user_name ??
                  record.label ??
                  financeActionLabels[record.kind ?? ""] ??
                  accountKindLabels[record.kind ?? ""] ??
                  title}
              </h3>
              <KeyValues values={recordValues(row)} />
              {((collection === "batches" && record.can_delete) ||
                (collection === "stages" && (record.can_delete || record.can_restore)) ||
                (["settlements", "public_awards"].includes(collection) && (record.can_manage || record.can_pay)) ||
                (["commitments", "public_commitments"].includes(collection) &&
                  record.can_manage &&
                  !record.cancelled) ||
                (collection === "operations" && record.can_manage && !record.reversed)) && (
                <details className="lab-disclosure">
                  <summary>记录操作</summary>
                  <div className="lab-actions">
                    {collection === "batches" && record.can_delete && (
                      <Button
                        onClick={() =>
                          setDeletion({
                            kind: "receipt",
                            id: record.id!,
                            name: record.source ?? "到账记录",
                            amount: record.gross,
                            blockedReason: record.delete_reason,
                          })
                        }
                      >
                        删除到账
                      </Button>
                    )}
                    {collection === "stages" && record.can_delete && (
                      <Button
                        onClick={() =>
                          setDeletion({
                            kind: "stage",
                            id: record.stage_id!,
                            name: record.name ?? "阶段预算",
                            blockedReason: record.delete_reason,
                          })
                        }
                      >
                        删除预算
                      </Button>
                    )}
                    {collection === "stages" && record.can_restore && (
                      <Button onClick={() => open("stage-restore", { stage_id: record.stage_id! })}>恢复预算</Button>
                    )}
                    {collection === "settlements" && record.can_pay && (
                      <Button onClick={() => open("commit", { settlement_id: record.id! })}>安排支付</Button>
                    )}
                    {collection === "public_awards" && record.can_manage && (
                      <Button onClick={() => open("public-commit", { award_id: record.id! })}>安排公共支付</Button>
                    )}
                    {["commitments", "public_commitments"].includes(collection) &&
                      record.can_manage &&
                      !record.cancelled && (
                        <>
                          <Button
                            onClick={() =>
                              open(collection === "commitments" ? "payment" : "public-payment", {
                                commitment_id: record.id!,
                              })
                            }
                          >
                            登记线下支付
                          </Button>
                          <Button
                            onClick={() =>
                              open(collection === "commitments" ? "cancel-commit" : "public-cancel-commit", {
                                commitment_id: record.id!,
                              })
                            }
                          >
                            取消未付安排
                          </Button>
                        </>
                      )}
                    {collection === "operations" && record.can_manage && !record.reversed && (
                      <Button onClick={() => open("reverse", { operation_id: record.id! })}>冲正</Button>
                    )}
                  </div>{" "}
                </details>
              )}
            </article>
          );
        })}
        {!records.length && <Empty />}
      </section>
    );
  }
  return (
    <>
      {!actionsOpen && (
        <>
          <PageHeading title={overview.projects.find((row) => row.id === project)?.name ?? "资金与奖励"}>
            <button type="button" className="icon-button" aria-label="更多资金视图" onClick={() => setMoreOpen(true)}>
              <CanonicalIcon name="menu" size={22} />
            </button>
          </PageHeading>
          <main className="m3-finance-body">
            <h1>资金与奖励</h1>
            <ErrorMessage error={resource.error || budgets.error || flow.error || ledger.error || store.error} />
            <label className="m3-fund-selector v6-select-chip">
              <CanonicalIcon name="ocean" size={20} />
              <span>
                {project ? overview.projects.find((row) => row.id === project)?.name : "实验室全部资金"}
                {project && lead ? " · 负责人" : ""}
              </span>
              <CanonicalIcon name="down" size={16} />
              <MobileSelect aria-label="资金项目" value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">实验室全部资金</option>
                {overview.projects
                  .filter((row) => deleted || !row.deleted)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.deleted ? " · 已删除" : row.is_lead ? " · 负责人" : ""}
                    </option>
                  ))}
              </MobileSelect>
            </label>
            {selectedProject?.can_manage_permissions && (
              <Button onClick={() => setPermissionsOpen(true)}>财务权限</Button>
            )}
            {permissionsOpen && selectedProject?.can_manage_permissions && (
              <FinancePermissionDialog
                key={project}
                store={store}
                projectId={project}
                onClose={() => setPermissionsOpen(false)}
                onSaved={refresh}
              />
            )}
            <div className="m3-tabs m3-finance-tabs" role="tablist">
              {tabs.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? "active" : ""}
                  onClick={() => setTab(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            {tab === "accounts" && (
              <>
                <div className="m3-cash-hero">
                  <div className="m3-cash-label">
                    <span>实际到账</span>
                    <span>{activeBatches.length} 笔到账</span>
                  </div>
                  <div className="m3-cash-value">
                    <small>¥</small>
                    {sumAmount(activeBatches.map((row) => row.gross))}
                  </div>
                  <div className="m3-cash-approved">
                    <span>累计核准 D</span>
                    <span>¥{sumAmount(activeBatches.map((row) => row.D))}</span>
                  </div>
                  <div className="m3-cash-rewards">
                    <div>
                      <span>可用执行奖励</span>
                      <strong>¥{sumAmount(executionAccounts.map((row) => row.available))}</strong>
                    </div>
                    <div>
                      <span>已安排支付</span>
                      <strong>¥{sumAmount(executionAccounts.map((row) => row.committed))}</strong>
                    </div>
                  </div>
                </div>
                {currentBudgets.map((row) => {
                  const stageBounties = new Set(
                    store.bounties.filter((bounty) => bounty.stage_id === row.stage_id).map((bounty) => bounty.id)
                  );
                  const awarded = ledger.data
                    ? sumAmount(
                        ledger.data.filter((entry) => stageBounties.has(entry.bounty_id)).map((entry) => entry.delta)
                      )
                    : null;
                  const unawarded =
                    row.reserved !== null && awarded !== null
                      ? labDecimalText((labDecimalUnits(row.reserved) ?? 0n) - (labDecimalUnits(awarded) ?? 0n))
                      : null;
                  const total = Number(row.budget) || 0;
                  const portions = [
                    { kind: "reserved", value: unawarded },
                    { kind: "free", value: row.available },
                    { kind: "granted", value: awarded },
                  ];
                  return (
                    <section className="m3-budget" key={row.stage_id ?? row.project_id}>
                      <div className="m3-budget-top">
                        <h2>{!project ? `${row.project} · ` : ""}项目 VC 预算</h2>
                        <span>{row.stage_name ?? "当前预算"}</span>
                      </div>
                      <div className="m3-budget-value">
                        {row.budget ?? "—"}
                        <small>VC</small>
                      </div>
                      <div
                        className="m3-budget-bar"
                        role="img"
                        aria-label={`占用未授予 ${unawarded ?? "未知"}，未占用 ${row.available ?? "未知"}，已授予净额 ${awarded ?? "未知"} VC`}
                      >
                        {portions.map(({ value, kind }) =>
                          value !== null && Number(value) > 0 ? (
                            <i
                              key={kind}
                              className={kind}
                              style={{ width: `${total > 0 ? (Math.max(0, Number(value)) / total) * 100 : 0}%` }}
                            />
                          ) : null
                        )}
                      </div>
                      {[
                        { name: "占用未授予", value: unawarded, kind: "" },
                        { name: "未占用", value: row.available, kind: "free" },
                        { name: "已授予净额", value: awarded, kind: "granted" },
                      ].map((stat) => (
                        <div className="m3-budget-row" key={stat.name}>
                          <span>
                            <i className={`m3-budget-dot ${stat.kind}`} />
                            {stat.name}
                          </span>
                          <strong>
                            {stat.value ?? "—"}
                            {stat.value !== null ? " VC" : ""}
                          </strong>
                        </div>
                      ))}
                    </section>
                  );
                })}
                {manageable && (
                  <button type="button" className="m3-button m3-finance-action" onClick={() => setActionsOpen(true)}>
                    <CanonicalIcon name="document" size={20} />
                    办理资金事项
                  </button>
                )}
              </>
            )}
            {tab === "stages" && (
              <>
                {recordSection("stages", "负责人事前阶段预算")}
                {overview.stages
                  .filter((stage) => deleted || !stage.deleted)
                  .map((stage) => (
                    <section key={stage.id}>
                      <h3 className="lab-section-heading">{stage.name} · 冻结参数</h3>
                      <KeyValues
                        values={Object.fromEntries(
                          stage.purposes.map((purpose) => [purpose.name, `¥${purpose.amount}`])
                        )}
                      />
                      {stage.members.map((member) => (
                        <article className="lab-card" key={member.user_id}>
                          <h3>{overview.members.find((person) => person.id === member.user_id)?.name ?? "成员"}</h3>
                          <KeyValues values={{ "计划 VC": member.planned_vc, b: member.b, r: member.r }} />
                        </article>
                      ))}
                      {stage.history.length ? (
                        <>
                          <h3 className="lab-section-heading">历史资格</h3>
                          {stage.history.map((member) => (
                            <KeyValues
                              key={member.user_id}
                              values={{
                                成员: overview.members.find((person) => person.id === member.user_id)?.name ?? "成员",
                                份额: member.share,
                                形成日期: member.qualified_at,
                                依据: member.basis,
                              }}
                            />
                          ))}
                        </>
                      ) : null}
                    </section>
                  ))}
                {recordSection("forecasts", "参考预测及公式快照")}
                <div className="lab-actions">
                  {project && lead && <Button onClick={() => setFormula(true)}>项目奖励公式</Button>}
                  {manageable && <Button onClick={() => setForecast("task")}>新增参考预测</Button>}
                  {manageable && (
                    <Button onClick={() => open("stage", project ? { project_id: project } : undefined)}>
                      冻结阶段奖励预算
                    </Button>
                  )}
                </div>
              </>
            )}
            {tab === "settlements" && (
              <>
                {recordSection("settlements", "累计最终核准与参考差异")}
                {recordSection("commitments", "现金承诺与支付安排")}
                {recordSection("public_awards", "公共职责月度固定奖励")}
                {recordSection("public_commitments", "公共职责支付安排")}
                {recordSection("payments", "线下付款与扣缴记录")}
                {recordSection("public_payments", "公共职责实付与扣缴")}
              </>
            )}
            {tab === "entries" && (
              <>
                {recordSection("entries", "账目明细")}
                {recordSection("operations", "操作依据与追加更正")}
              </>
            )}
            {tab === "workflow" && flow.data && (
              <>
                <h3>{flow.data.title}</h3>
                <LabField label="流程范围">
                  <MobileSelect value={workflowScope} onChange={(event) => setWorkflowScope(event.target.value)}>
                    <option value="finance">资金流程</option>
                    <option value="project" disabled={!project}>
                      选中项目的完整生命周期
                    </option>
                  </MobileSelect>
                </LabField>
                {flow.data.nodes.map((row) => (
                  <article className="lab-timeline-row" key={row.id}>
                    <h3>{row.label}</h3>
                    <p className="lab-muted">
                      {row.state === "current" ? "当前可办理" : row.state === "completed" ? "已有记录" : "尚未发生"}
                    </p>
                    <div className="lab-actions">
                      {flow.data?.actions
                        .filter((action) => action.node_id === row.id)
                        .map((action) => (
                          <Button
                            key={action.id}
                            title={action.reason}
                            disabled={!action.enabled}
                            onClick={() => open(action.action, action.body)}
                          >
                            {action.label}
                          </Button>
                        ))}
                    </div>
                  </article>
                ))}
                {flow.data.history
                  .slice()
                  // oxlint-disable-next-line unicorn/no-array-reverse -- ES2022 target; reverses a new local copy
                  .reverse()
                  .map((event) => (
                    <article className="lab-card" key={event.id}>
                      <h3>{event.label}</h3>
                      <KeyValues
                        values={{
                          经办人: event.actor,
                          时间: event.created_at,
                          依据: event.reason,
                          凭证: event.evidence,
                        }}
                      />
                      {event.snapshot && (
                        <details>
                          <summary>业务计算快照</summary>
                          <KeyValues values={event.snapshot} />
                        </details>
                      )}
                    </article>
                  ))}
              </>
            )}
            {tab === "ledger" && (
              <>
                {ledger.data?.map((row) => (
                  <article className="lab-card" key={row.id}>
                    <h3>{row.task.title}</h3>
                    <KeyValues
                      values={{
                        项目: row.task.project,
                        参与者: row.participant.name,
                        "VC 变化": row.delta,
                        验收人: row.actor,
                        原因: row.reason,
                        时间: row.created_at,
                        类型: row.reverses ? "更正" : "授予",
                      }}
                    />
                    <div className="lab-actions">
                      {row.can_reverse && (
                        <Button onClick={() => setLedgerReverse({ entry: row, key: newRequestKey() })}>贡献冲正</Button>
                      )}
                      {row.task.id && row.task.project_id && onOpenIssue && (
                        <Button onClick={() => onOpenIssue(row.task.project_id!, row.task.id!)}>任务详情</Button>
                      )}
                    </div>
                  </article>
                ))}
                {ledger.data && !ledger.data.length && <Empty />}
              </>
            )}
          </main>
        </>
      )}
      {moreOpen && (
        <LabDialog title="资金视图与管理" onClose={() => setMoreOpen(false)}>
          <label className="lab-switch-field">
            <span>显示已删除记录</span>
            <input type="checkbox" checked={deleted} onChange={(event) => setDeleted(event.target.checked)} />
          </label>
          <div className="lab-action-list">
            {tabs.slice(4).map((item) => (
              <button
                key={item.id}
                className="lab-action-row"
                onClick={() => {
                  setTab(item.id);
                  setMoreOpen(false);
                }}
              >
                {item.name}
                <CanonicalIcon name="chevron" size={20} />
              </button>
            ))}
            {currentBudgets
              .filter((row) => row.can_restore)
              .map((row) => (
                <button
                  key={row.stage_id}
                  className="lab-action-row"
                  onClick={() => {
                    setMoreOpen(false);
                    open("stage-restore", { stage_id: row.stage_id! });
                  }}
                >
                  恢复 {row.stage_name ?? row.project} 预算
                  <CanonicalIcon name="chevron" size={20} />
                </button>
              ))}
            {manageable && (
              <button
                className="lab-action-row"
                onClick={() => {
                  setMoreOpen(false);
                  setActionsOpen(true);
                }}
              >
                办理资金事项
                <CanonicalIcon name="chevron" size={20} />
              </button>
            )}
            {deletable.length > 0 && (
              <button
                className="lab-action-row"
                onClick={() => {
                  setMoreOpen(false);
                  setDeletePickerOpen(true);
                }}
              >
                删除到账／阶段／资金项目
                <CanonicalIcon name="chevron" size={20} />
              </button>
            )}
            {data.can_designate_manager && (
              <button
                className="lab-action-row"
                onClick={() => {
                  setMoreOpen(false);
                  open("manager");
                }}
              >
                指定公共资金管理员
                <CanonicalIcon name="chevron" size={20} />
              </button>
            )}
            <button
              className="lab-action-row"
              onClick={() => {
                setMoreOpen(false);
                void refresh().catch(() => {});
              }}
            >
              刷新资金
              <CanonicalIcon name="refresh" size={20} />
            </button>
          </div>
          {project && (
            <details>
              <summary>资金项目管理</summary>
              {data.projects
                .filter((row) => row.id === project)
                .map((row) => (
                  <div key={row.id} className="lab-actions">
                    {row.can_delete && (
                      <Button
                        onClick={() =>
                          setDeletion({
                            kind: "project",
                            id: row.id,
                            name: row.name,
                            blockedReason: row.delete_reason ?? undefined,
                          })
                        }
                      >
                        删除资金项目
                      </Button>
                    )}

                    {row.can_restore && (
                      <Button onClick={() => open("project-restore", { project_id: row.id })}>恢复资金项目</Button>
                    )}
                  </div>
                ))}
            </details>
          )}

          <details className="v6-finance-records">
            <summary>
              账户与到账明细
              <CanonicalIcon name="down" size={18} />
            </summary>
            {recordSection("accounts", "真实账户余额")}
            {overview.public_summary?.length ? (
              <section>
                <h3 className="lab-section-heading">公共资金余额</h3>
                <div className="lab-stats two">
                  {overview.public_summary.map((row) => (
                    <div className="lab-stat" key={row.kind}>
                      <span>{row.label}</span>
                      <strong>¥{row.available}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {recordSection("batches", "实际到账与准备金明细")}
          </details>
        </LabDialog>
      )}
      {actionsOpen && (
        <LabDetail
          title="办理资金事项"
          onClose={() => setActionsOpen(false)}
          actions={
            <button
              className="m3-icon-button bx-icon-button"
              aria-label="刷新资金事项"
              onClick={() => void refresh().catch(() => {})}
            >
              <CanonicalIcon name="refresh" size={24} />
            </button>
          }
        >
          <main className="bx-body bx-actions-body">
            <div className="bx-context-label">
              {overview.projects.find((row) => row.id === project)?.name ?? "实验室全部资金"}
              <span>{lead ? "负责人" : data.is_manager ? "资金管理员" : "成员"}</span>
            </div>
            {!manageable && <Empty>暂无可办理资金事项。</Empty>}
            <div className="bx-actions-index">
              {actionGroups.map((group, i) => {
                const available = group.actions.filter(
                  (action) =>
                    (manageable && actions.has(action)) ||
                    (action === "vc-stage" && lead) ||
                    (action === "formula" && canApprove) ||
                    (action === "forecast-task" && canApprove) ||
                    (action === "forecast-member" && data.stages.some((row) => !row.deleted)) ||
                    (action === "delete" && deletable.length > 0) ||
                    (action === "manager" && data.can_designate_manager) ||
                    (["stage-restore", "project-restore"].includes(action) && !!selectedProject?.can_manage_permissions)
                );
                if (!available.length) return null;
                return (
                  <details className="bx-action-group" key={group.title} open={i === 0 ? true : undefined}>
                    <summary>
                      <span className="bx-group-icon">
                        <CanonicalIcon
                          name={(["wallet", "check", "archive", "users", "document", "clock"] as const)[i]!}
                          size={24}
                        />
                      </span>
                      <span className="bx-group-title">{group.title}</span>
                      <span className="bx-group-count">{available.length} 项</span>
                      <CanonicalIcon name="down" size={20} className="bx-expander" />
                    </summary>
                    <div className="bx-action-list">
                      {available.map((action) => (
                        <button
                          className="bx-action-row"
                          key={action}
                          onClick={() => {
                            if (action === "formula") setFormula(true);
                            else if (action === "forecast-task" || action === "forecast-member")
                              setForecast(action === "forecast-task" ? "task" : "member");
                            else if (action === "delete") setDeletePickerOpen(true);
                            else open(action, project ? { project_id: project } : undefined);
                          }}
                        >
                          <span>
                            {action === "formula"
                              ? "项目奖励公式"
                              : action === "forecast-task"
                                ? "任务预计奖励"
                                : action === "forecast-member"
                                  ? "成员预计奖励"
                                  : action === "delete"
                                    ? "删除到账／阶段／资金项目"
                                    : (financeActionLabels[action] ?? action)}
                          </span>
                          <CanonicalIcon name="chevron" size={20} />
                        </button>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </main>
        </LabDetail>
      )}
      {deletePickerOpen && (
        <LabDialog title="选择删除记录" onClose={() => setDeletePickerOpen(false)}>
          <div className="lab-action-list">
            {deletable.map((row) => (
              <button
                className="lab-action-row"
                key={`${row.kind}-${row.id}`}
                onClick={() => {
                  setDeletePickerOpen(false);
                  setDeletion(row);
                }}
              >
                <span>
                  {row.kind === "receipt" ? "到账" : row.kind === "stage" ? "阶段预算" : "资金项目"} · {row.name}
                </span>
                <span aria-hidden>›</span>
              </button>
            ))}
          </div>
          {!deletable.length && <Empty>暂无可删除的资金记录。</Empty>}
        </LabDialog>
      )}
      {chosen && (
        <LabFinanceActionDialog
          store={store}
          data={data}
          projectId={project}
          chosen={chosen}
          onClose={() => setChosen(undefined)}
          onSaved={refresh}
        />
      )}
      {formula && (
        <LabFormulaEditor store={store} projectId={project} onClose={() => setFormula(false)} onSaved={refresh} />
      )}
      {forecast && (
        <LabForecastDialog
          store={store}
          data={data}
          projectId={project}
          initialKind={forecast}
          onClose={() => setForecast(undefined)}
          onSaved={refresh}
        />
      )}
      {deletion && (
        <LabFinanceDeleteDialog
          store={store}
          target={deletion}
          onClose={() => setDeletion(undefined)}
          onSaved={refresh}
        />
      )}
      {ledgerReverse && (
        <LabDialog
          title="贡献冲正"
          destructive
          onClose={() => setLedgerReverse(undefined)}
          onSubmit={async (form) => {
            await store.request(`ledger/${ledgerReverse.entry.id}/reverse/`, "POST", {
              request_key: ledgerReverse.key,
              reason: form.get("reason"),
            });
            await refresh();
            setLedgerReverse(undefined);
          }}
        >
          <p>
            为 {ledgerReverse.entry.participant.name} 追加 −{ledgerReverse.entry.delta} VC，更正将保留原始记录。
          </p>
          <LabField label="更正原因">
            <textarea name="reason" required />
          </LabField>
        </LabDialog>
      )}
    </>
  );
}
