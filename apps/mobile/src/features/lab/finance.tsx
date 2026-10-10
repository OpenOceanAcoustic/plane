/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState, useEffect } from "react";
import type { LabBountyBudget, LabFinanceOverview, LabRecordWorkflow, LabLedgerEntry } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { LabFinanceActionDialog, financeActionLabels, accountKindLabels } from "./finance-form";
import type { LabFinanceChosenAction } from "./finance-form";
import { LabFormulaEditor, LabForecastDialog } from "./finance-formula";
import { LabFinanceDeleteDialog } from "./finance-delete";
import type { LabFinanceDeletion } from "./finance-delete";
import { Button, LabDialog, LabField, Tabs, ErrorMessage, Empty, KeyValues } from "./ui";
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
  { id: "accounts", name: "分池账户" },
  { id: "stages", name: "阶段预算" },
  { id: "batches", name: "到账批次" },
  { id: "forecasts", name: "奖励预测" },
  { id: "settlements", name: "奖励核准" },
  { id: "commitments", name: "支付安排" },
  { id: "payments", name: "支付登记" },
  { id: "public_awards", name: "公共职责" },
  { id: "public_commitments", name: "公共支付安排" },
  { id: "public_payments", name: "公共支付登记" },
  { id: "operations", name: "操作记录" },
  { id: "entries", name: "资金明细" },
  { id: "ledger", name: "VC账本" },
  { id: "workflow", name: "资金流程" },
];
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
  const [tab, setTab] = useState(initialTab);
  const [workflowScope, setWorkflowScope] = useState("finance");
  const [chosen, setChosen] = useState<LabFinanceChosenAction>();
  const [formula, setFormula] = useState(false);
  const [forecast, setForecast] = useState(false);
  const [deletion, setDeletion] = useState<LabFinanceDeletion>();
  const [actionsOpen, setActionsOpen] = useState(false);
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
    tab === "ledger" ? `ledger/${project ? `?project_id=${project}` : ""}` : null
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
      ...(tab === "ledger" ? [ledger.refresh()] : []),
    ]);
  };
  const open = (action: string, body?: Record<string, string>) => {
    setActionsOpen(false);
    setChosen({ action, body });
  };
  if (!data)
    return (
      <>
        <ErrorMessage error={resource.error} />
        <Empty>正在加载资金…</Empty>
      </>
    );
  const lead = project
    ? !!data.projects.find((row) => row.id === project && row.is_lead && !row.deleted)
    : data.projects.some((row) => row.is_lead && !row.deleted);
  const manageable = lead || data.is_manager;
  const actions = [
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
    ...(data.is_manager
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
  const group = tab in data ? data[tab as keyof LabFinanceOverview] : undefined;
  const records = Array.isArray(group) ? group : [];
  return (
    <>
      <div className="lab-heading">
        <h2>资金与奖励</h2>
        <Button onClick={() => void refresh().catch(() => {})}>刷新</Button>
      </div>
      <ErrorMessage error={resource.error || budgets.error || flow.error || ledger.error || store.error} />
      <LabField label="资金项目">
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">实验室全部资金</option>
          {data.projects
            .filter((row) => deleted || !row.deleted)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {row.deleted ? " · 已删除" : ""}
              </option>
            ))}
        </select>
      </LabField>
      <div className="lab-actions">
        {manageable && (
          <Button variant="primary" onClick={() => setActionsOpen(true)}>
            办理资金事项
          </Button>
        )}
        {lead && <Button onClick={() => open("vc-stage", { project_id: project })}>设置 VC 预算</Button>}
        {project && lead && <Button onClick={() => setFormula(true)}>奖励公式</Button>}
        {manageable && <Button onClick={() => setForecast(true)}>创建参考预测</Button>}
        {data.can_designate_manager && <Button onClick={() => open("manager")}>指定公共资金管理员</Button>}
        <label>
          <input type="checkbox" checked={deleted} onChange={(e) => setDeleted(e.target.checked)} />
          查看已删除预算
        </label>
      </div>
      <div className="lab-grid">
        {data.public_summary?.map((row) => (
          <article className="lab-card" key={row.kind}>
            <span className="lab-muted">{row.label}</span>
            <strong className="lab-amount-total">¥{row.available}</strong>
            <KeyValues values={{ 实际余额: row.balance, 已安排: row.committed }} />
          </article>
        ))}
      </div>
      <details open>
        <summary>项目 VC 预算</summary>
        {budgets.data
          ?.filter((row) => (!project || row.project_id === project) && (deleted || !row.deleted))
          .map((row) => (
            <article className="lab-card" key={row.project_id}>
              <h3>{row.project}</h3>
              <KeyValues
                values={{
                  预算: row.budget,
                  已占用: row.reserved,
                  可用: row.available,
                  状态: row.deleted ? "已删除" : row.configured ? "已配置" : "尚未配置",
                }}
              />
              <div className="lab-actions">
                {row.can_delete && (
                  <Button
                    onClick={() =>
                      setDeletion({
                        kind: "stage",
                        id: row.stage_id!,
                        name: row.stage_name ?? row.project,
                        blockedReason: row.delete_reason ?? undefined,
                      })
                    }
                  >
                    删除阶段预算
                  </Button>
                )}
                {row.can_restore && (
                  <Button onClick={() => open("stage-restore", { stage_id: row.stage_id! })}>恢复预算</Button>
                )}
              </div>
            </article>
          ))}
      </details>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {records.map((row) => {
        const record = row as {
          id?: string;
          stage_id?: string;
          name?: string;
          source?: string;
          gross?: string;
          can_manage?: boolean;
          can_delete?: boolean;
          can_restore?: boolean;
          delete_reason?: string;
          deleted?: boolean;
          cancelled?: boolean;
          reversed?: boolean;
        };
        if (record.deleted && !deleted) return null;
        return (
          <article key={record.id} className="lab-card">
            <KeyValues values={recordValues(row)} />
            <div className="lab-actions">
              {tab === "batches" && record.can_delete && (
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
              {tab === "stages" && record.can_delete && (
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
              {tab === "stages" && record.can_restore && (
                <Button onClick={() => open("stage-restore", { stage_id: record.stage_id! })}>恢复预算</Button>
              )}
              {tab === "settlements" && record.can_manage && (
                <Button onClick={() => open("commit", { settlement_id: record.id! })}>安排支付</Button>
              )}
              {tab === "public_awards" && record.can_manage && (
                <Button onClick={() => open("public-commit", { award_id: record.id! })}>安排公共支付</Button>
              )}
              {["commitments", "public_commitments"].includes(tab) && record.can_manage && !record.cancelled && (
                <>
                  <Button
                    onClick={() =>
                      open(tab === "commitments" ? "payment" : "public-payment", { commitment_id: record.id! })
                    }
                  >
                    登记线下支付
                  </Button>
                  <Button
                    onClick={() =>
                      open(tab === "commitments" ? "cancel-commit" : "public-cancel-commit", {
                        commitment_id: record.id!,
                      })
                    }
                  >
                    取消未付安排
                  </Button>
                </>
              )}
              {tab === "operations" && record.can_manage && !record.reversed && (
                <Button onClick={() => open("reverse", { operation_id: record.id! })}>冲正</Button>
              )}
            </div>
          </article>
        );
      })}
      {Array.isArray(group) && !records.length && <Empty />}
      {tab === "workflow" && flow.data && (
        <>
          <h3>{flow.data.title}</h3>
          <LabField label="流程范围">
            <select value={workflowScope} onChange={(event) => setWorkflowScope(event.target.value)}>
              <option value="finance">资金流程</option>
              <option value="project" disabled={!project}>
                选中项目的完整生命周期
              </option>
            </select>
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
                  values={{ 经办人: event.actor, 时间: event.created_at, 依据: event.reason, 凭证: event.evidence }}
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
      {actionsOpen && (
        <LabDialog title="办理资金事项" onClose={() => setActionsOpen(false)}>
          {actions.map((action) => (
            <Button key={action} onClick={() => open(action, project ? { project_id: project } : undefined)}>
              {financeActionLabels[action] ?? action}
            </Button>
          ))}
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
          onClose={() => setForecast(false)}
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
