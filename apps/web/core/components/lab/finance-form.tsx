/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { LabFinanceOverview } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";
import { calendarInstant } from "./calendar-time";

export const financeActionLabels: Record<string, string> = {
  stage: "冻结阶段奖励预算",
  receipt: "登记真实到账",
  opening: "录入期初余额",
  transfer: "账户划拨",
  expense: "登记实际支出",
  settlement: "核准最终执行奖励",
  "history-settlement": "核算历史奖励",
  commit: "安排现金支付",
  "cancel-commit": "取消未付安排",
  payment: "登记线下支付",
  "tax-remit": "登记扣缴款上缴",
  "risk-release": "释放原批次风险金",
  "future-plan": "年度研究／探索编列",
  dispute: "登记争议预留",
  "resolve-dispute": "释放争议预留",
  carryover: "结转未用余额",
  reverse: "冲正资金操作",
  manager: "指定公共资金管理员",
  "vc-stage": "设置项目 VC 预算",
  "exploration-allocation": "拨付探索阶段奖励",
  "stage-allocation": "拨付留存至新阶段奖励",
  "risk-use": "登记风险事项实际支出",
  "public-duty": "核准公共职责奖励",
  "public-commit": "安排公共职责支付",
  "public-cancel-commit": "取消公共职责未付安排",
  "public-payment": "登记公共职责线下支付",
};
export const accountKindLabels: Record<string, string> = {
  project: "项目资金",
  execution: "阶段执行奖励",
  history: "历史孵化奖励",
  risk: "风险准备金",
  future_pool: "未来项目池",
  public: "公共贡献池",
  future_research: "研究支出",
  future_exploration: "探索奖励",
  retained: "留存",
  dispute: "争议预留",
  withholding: "扣缴待上缴",
};
type Option = { value: string; label: string };
type Field = {
  key: string;
  label: string;
  type?: "number" | "textarea" | "date" | "datetime-local" | "month";
  options?: Option[];
  required?: boolean;
  value?: string;
  min?: string;
  max?: string;
};
export type LabFinanceChosenAction = { action: string; body?: Record<string, string> };
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

const number = (key: string, label: string, required = true, value?: string): Field => ({
  key,
  label,
  type: "number",
  required,
  value,
  min: "0",
});
const select = (key: string, label: string, options: Option[], required = true): Field => ({
  key,
  label,
  options,
  required,
});

export function LabFinanceActionDialog({
  store,
  data,
  projectId,
  chosen,
  onClose,
  onSaved,
}: {
  store: LabStore;
  data: LabFinanceOverview;
  projectId: string;
  chosen: LabFinanceChosenAction;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [requestKey] = useState(() => uuidv4());
  const [upgraded, setUpgraded] = useState(false);
  const [purposes, setPurposes] = useState(() => [uuidv4()]);
  const [shares, setShares] = useState(() => [uuidv4()]);
  const [history, setHistory] = useState(() => [uuidv4()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [allocationSource, setAllocationSource] = useState(chosen.body?.from_account_id ?? "");
  const defaults = chosen.body ?? {};
  const action = chosen.action;
  const members = data.members.map((member) => ({ value: member.id, label: member.name }));
  const manageable = data.accounts.filter((account) => account.can_manage);
  const accounts = manageable.map((account) => ({
    value: account.id,
    label: `${account.label} · 可用 ¥${account.available}`,
  }));
  const stages = data.stages
    .filter((stage) => stage.can_manage)
    .map((stage) => ({ value: stage.stage_id, label: `${stage.name} · 执行实额 ¥${stage.execution_funded}` }));
  const unsettledStages = (store.stages ?? [])
    .filter(
      (stage) =>
        (!projectId || stage.project_id === projectId) &&
        !data.stages.some((row) => row.stage_id === stage.id) &&
        store.planner?.projects.some((project) => project.id === stage.project_id && project.lead)
    )
    .map((stage) => ({ value: stage.id, label: `${stage.project} · ${stage.name} · B ${stage.budget} VC` }));
  const settlements = data.settlements
    .filter((row) => row.can_manage)
    .map((row) => ({
      value: row.id,
      label: `${row.user_name} · ${row.kind === "history" ? "历史" : "执行"} · 待付 ¥${row.outstanding}`,
    }));
  const commitments = data.commitments
    .filter((row) => row.can_manage && !row.cancelled && row.remaining !== "0.00")
    .map((row) => ({
      value: row.id,
      label: `${data.members.find((member) => member.id === row.user_id)?.name ?? "成员"} · 未付安排 ¥${row.remaining}`,
    }));
  let fields: Field[] = [];
  switch (action) {
    case "stage-allocation":
      fields = [
        select(
          "from_account_id",
          "同项目留存来源账户",
          manageable
            .filter((account) => account.kind === "retained")
            .map((account) => ({ value: account.id, label: `${account.label} · 可用 ¥${account.available}` }))
        ),
        select(
          "stage_id",
          "已冻结的新阶段",
          data.stages
            .filter(
              (stage) =>
                stage.can_manage &&
                stage.project_id === manageable.find((account) => account.id === allocationSource)?.project_id &&
                stage.stage_id !== manageable.find((account) => account.id === allocationSource)?.stage_id
            )
            .map((stage) => ({ value: stage.stage_id, label: `${stage.name} · 预算 E ¥${stage.E}` }))
        ),
        number("amount", "留存拨付执行奖励（元）"),
      ];
      break;
    case "risk-use":
      fields = [
        select(
          "batch_id",
          "原到账风险准备金批次",
          data.batches
            .filter((row) => row.can_manage)
            .map((row) => ({ value: row.id, label: `${row.source} · 尚余 ¥${row.risk_remaining}` }))
        ),
        select("category", "责任事项类别", [
          { value: "refund", label: "退款责任" },
          { value: "rework", label: "返工责任" },
        ]),
        number("amount", "已批准的实际支出（元）"),
        { key: "purpose", label: "责任事项及实际用途", required: true },
      ];
      break;
    case "public-duty":
      fields = [
        select("user_id", "公共职责成员", members),
        { key: "period", label: "履职月份", type: "month", required: true },
        { key: "duty", label: "职责与履职核准依据", type: "textarea", required: true },
        number("amount", "本月累计固定奖励（元）"),
        select(
          "award_id",
          "追加修订的原核准（可选）",
          (data.public_awards ?? [])
            .filter((row) => row.can_manage)
            .map((row) => ({ value: row.id, label: `${row.user_name} · ${row.period} · ¥${row.amount}` })),
          false
        ),
      ];
      break;
    case "public-commit":
      fields = [
        select(
          "award_id",
          "已核准公共职责奖励",
          (data.public_awards ?? [])
            .filter((row) => row.can_manage)
            .map((row) => ({ value: row.id, label: `${row.user_name} · ${row.period} · 待付 ¥${row.outstanding}` }))
        ),
        number("amount", "本次公共职责支付安排（元）"),
      ];
      break;
    case "public-cancel-commit":
    case "public-payment":
      fields = [
        select(
          "commitment_id",
          "公共职责未付支付安排",
          (data.public_commitments ?? [])
            .filter((row) => row.can_manage && !row.cancelled && !/^0(?:\.0*)?$/.test(row.remaining))
            .map((row) => ({ value: row.id, label: `${row.user_name} · 尚余 ¥${row.remaining}` }))
        ),
        ...(action === "public-payment"
          ? [
              number("gross", "本次核销应付（元）"),
              number("withheld", "本次扣缴（元）", true, "0"),
              { key: "reference", label: "线下付款凭证号", required: true },
            ]
          : []),
      ];
      break;
    case "vc-stage":
      fields = [
        select(
          "project_id",
          "负责项目",
          data.projects
            .filter((project) => project.is_lead)
            .map((project) => ({ value: project.id, label: project.name }))
        ),
        { key: "name", label: "预算名称", required: true, value: "当前预算" },
        number("budget", "VC 预算"),
      ];
      break;
    case "exploration-allocation":
      fields = [
        select(
          "stage_id",
          "探索阶段",
          (data.funding_targets ?? []).map((stage) => ({
            value: stage.stage_id,
            label: `${stage.project} · ${stage.name}`,
          }))
        ),
        number("amount", "探索奖励拨付（元）"),
      ];
      break;
    case "manager":
      fields = [
        select(
          "user_id",
          "指定在职工作区管理员",
          data.members.filter((member) => member.is_admin).map((member) => ({ value: member.id, label: member.name }))
        ),
      ];
      break;
    case "stage":
      fields = [select("stage_id", "事前冻结的 VC 阶段 B", unsettledStages), number("E", "阶段执行奖励预算 E（元）")];
      break;
    case "receipt":
      fields = [
        select("stage_id", "阶段", stages),
        number("gross", "本次真实到账（元）"),
        number("costs", "本次成本扣除（元）", true, "0"),
        number("D", "本次核准可分配 D（元）"),
        { key: "source", label: "到账来源", required: true },
      ];
      break;
    case "opening":
      fields = [
        select("project_id", "资金归属", [
          { value: "public", label: "实验室公共资金" },
          ...data.projects
            .filter((project) => project.is_lead)
            .map((project) => ({ value: project.id, label: project.name })),
        ]),
        select("stage_id", "所属阶段（奖励余额必填）", stages, false),
        select(
          "kind",
          "账户类型",
          Object.entries(accountKindLabels).map(([value, label]) => ({ value, label }))
        ),
        number("amount", "期初实际余额（元）"),
        { key: "source", label: "余额来源", required: true },
      ];
      break;
    case "transfer":
      fields = [
        select("from_account_id", "转出账户", accounts),
        select("to_account_id", "转入账户", accounts),
        number("amount", "划拨金额（元）"),
      ];
      break;
    case "expense":
      fields = [
        select(
          "account_id",
          "支出账户",
          accounts.filter((option) =>
            manageable.some(
              (account) =>
                account.id === option.value &&
                ["project", "retained", "public", "future_research", "future_exploration"].includes(account.kind)
            )
          )
        ),
        number("amount", "实际支出（元）"),
        { key: "purpose", label: "用途／公共职责依据", required: true },
        select("user_id", "受益或经办成员（可选）", members, false),
      ];
      break;
    case "settlement":
      fields = [
        select("stage_id", "阶段", stages),
        select("user_id", "奖励成员", members),
        number("amount", "个人阶段累计最终核准金额（元）"),
        { key: "performance_basis", label: "绩效与核准依据", type: "textarea", required: true },
        select(
          "forecast_id",
          "关联参考预测（可选）",
          data.forecasts
            .filter((row) => row.kind === "member")
            .map((row) => ({
              value: row.id,
              label: `${data.members.find((member) => member.id === row.user_id)?.name ?? "成员"} · ¥${row.result} · 公式 v${row.formula_version} · ${row.basis === "budget" ? "预算" : "到账"}`,
            })),
          false
        ),
      ];
      break;
    case "history-settlement":
      fields = [select("stage_id", "按冻结历史资格核算阶段", stages)];
      break;
    case "commit":
      fields = [select("settlement_id", "已核准奖励", settlements), number("amount", "本次支付安排金额（元）")];
      break;
    case "cancel-commit":
      fields = [select("commitment_id", "取消未付支付安排", commitments)];
      break;
    case "payment":
      fields = [
        select("commitment_id", "已批准的现金支付安排", commitments),
        number("gross", "本次核销应付（元）"),
        number("withheld", "本次扣缴（元）", true, "0"),
        { key: "reference", label: "线下付款凭证号", required: true },
      ];
      break;
    case "tax-remit":
      fields = [
        select(
          "account_id",
          "扣缴待上缴账户",
          accounts.filter((option) =>
            manageable.some((account) => account.id === option.value && account.kind === "withholding")
          )
        ),
        number("amount", "线下上缴金额（元）"),
      ];
      break;
    case "risk-release":
      fields = [
        select(
          "batch_id",
          "原到账批次",
          data.batches
            .filter((row) => row.can_manage)
            .map((row) => ({ value: row.id, label: `${row.source} · 风险金尚余 ¥${row.risk_remaining}` }))
        ),
        number("amount", "释放金额（元）"),
      ];
      break;
    case "future-plan":
      fields = [
        {
          key: "year",
          label: "编列年度",
          type: "number",
          min: "2020",
          value: String(new Date().getFullYear()),
          required: true,
        },
        number("amount", "该年度尚未编列的新增未来池资金（元）"),
      ];
      break;
    case "dispute":
      fields = [
        select(
          "from_account_id",
          "原阶段执行账户",
          accounts.filter((option) =>
            manageable.some((account) => account.id === option.value && account.kind === "execution")
          )
        ),
        number("amount", "预留争议金额（元）"),
      ];
      break;
    case "resolve-dispute":
      fields = [
        select(
          "from_account_id",
          "原争议账户",
          accounts.filter((option) =>
            manageable.some((account) => account.id === option.value && account.kind === "dispute")
          )
        ),
        select(
          "to_account_id",
          "退回同阶段执行账户",
          accounts.filter((option) =>
            manageable.some((account) => account.id === option.value && account.kind === "execution")
          )
        ),
        number("amount", "释放金额（元）"),
      ];
      break;
    case "carryover":
      fields = [
        select(
          "from_account_id",
          "原阶段执行账户",
          accounts.filter((option) =>
            manageable.some((account) => account.id === option.value && account.kind === "execution")
          )
        ),
        number("amount", "未用余额结转（元）"),
      ];
      break;
    case "reverse":
      fields = [
        select(
          "operation_id",
          "追加冲正的原操作",
          data.operations
            .filter((row) => row.can_manage && !row.reversed && !row.reverses_id)
            .map((row) => ({
              value: row.id,
              label: `${financeActionLabels[row.kind] ?? row.kind} · ${row.reason} · ${row.created_at.slice(0, 10)}`,
            }))
        ),
      ];
      break;
  }
  return (
    <LabDialog
      title={financeActionLabels[action] ?? "办理资金事项"}
      busy={store.busy || saving}
      onClose={onClose}
      error={error}
      onSubmit={async (form) => {
        setError("");
        setSaving(true);
        const body: Record<string, unknown> = {
          ...defaults,
          request_key: requestKey,
          reason: text(form, "reason"),
          evidence: text(form, "evidence"),
        };
        for (const field of fields) {
          const value = text(form, field.key);
          if (value && value !== "public") body[field.key] = value;
        }
        const occurredAt = text(form, "occurred_at");
        if (occurredAt) body.occurred_at = calendarInstant(occurredAt);
        if (action === "stage") {
          body.upgraded = upgraded;
          body.purposes = purposes.map((id) => ({
            name: text(form, `purpose-name-${id}`),
            amount: text(form, `purpose-amount-${id}`),
          }));
          body.members = shares
            .filter((id) => text(form, `share-user-${id}`))
            .map((id) => ({
              user_id: text(form, `share-user-${id}`),
              b: text(form, `share-b-${id}`),
              r: text(form, `share-r-${id}`),
              planned_vc: text(form, `share-vc-${id}`),
            }));
          body.history = upgraded
            ? history
                .filter((id) => text(form, `history-user-${id}`))
                .map((id) => ({
                  user_id: text(form, `history-user-${id}`),
                  vc: text(form, `history-vc-${id}`),
                  funding_source: text(form, `history-source-${id}`),
                  inherited_from: text(form, `history-inherit-${id}`) || undefined,
                  source_basis: text(form, `history-inherit-basis-${id}`) || undefined,
                  qualified_at: text(form, `history-date-${id}`),
                  basis: text(form, `history-basis-${id}`),
                }))
            : [];
        }
        try {
          await store.request(action === "vc-stage" ? "stages/" : `finance/${action}/`, "POST", body);
          if (action === "vc-stage") await store.loadMarket();
          await onSaved();
          onClose();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "操作失败");
        } finally {
          setSaving(false);
        }
      }}
    >
      {fields.map((field) => (
        <LabField key={field.key} label={field.label}>
          {field.options ? (
            <select
              name={field.key}
              required={field.required}
              defaultValue={defaults[field.key] ?? (field.key === "project_id" ? projectId || "public" : "")}
              className={labInputClass}
              onChange={(event) => {
                if (action === "stage-allocation" && field.key === "from_account_id")
                  setAllocationSource(event.target.value);
              }}
            >
              <option value="">请选择</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              name={field.key}
              required={field.required}
              rows={3}
              className={labInputClass}
              defaultValue={defaults[field.key] ?? field.value}
            />
          ) : (
            <input
              name={field.key}
              type={field.type ?? "text"}
              min={field.min}
              max={field.max}
              step={field.type === "number" ? (field.key === "year" ? "1" : "0.01") : undefined}
              required={field.required}
              className={labInputClass}
              defaultValue={defaults[field.key] ?? field.value}
            />
          )}
        </LabField>
      ))}
      {action === "stage" && (
        <>
          <fieldset className="space-y-3 rounded border border-subtle p-3">
            <legend className="text-13 font-medium">预算用途条目（金额之和须等于 E）</legend>
            {purposes.map((id) => (
              <div key={id} className="grid grid-cols-2 gap-2">
                <LabField label="用途">
                  <input name={`purpose-name-${id}`} required className={labInputClass} />
                </LabField>
                <LabField label="用途金额（元）">
                  <input
                    name={`purpose-amount-${id}`}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    className={labInputClass}
                  />
                </LabField>
                <Button
                  size="sm"
                  variant="neutral-primary"
                  disabled={purposes.length === 1}
                  onClick={() => setPurposes((rows) => rows.filter((row) => row !== id))}
                >
                  删除用途
                </Button>
              </div>
            ))}
            <Button size="sm" variant="neutral-primary" onClick={() => setPurposes((rows) => [...rows, uuidv4()])}>
              添加用途条目
            </Button>
          </fieldset>
          <fieldset className="space-y-3 rounded border border-subtle p-3">
            <legend className="text-13 font-medium">事前冻结成员参数</legend>
            {shares.map((id) => (
              <div key={id} className="grid grid-cols-2 gap-2">
                <LabField label="成员">
                  <select name={`share-user-${id}`} className={labInputClass}>
                    <option value="">不添加</option>
                    {members.map((member) => (
                      <option key={member.value} value={member.value}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                </LabField>
                <LabField label="计划 VC">
                  <input
                    name={`share-vc-${id}`}
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    className={labInputClass}
                  />
                </LabField>
                <LabField label="基础份额 b（0–1）">
                  <input
                    name={`share-b-${id}`}
                    type="number"
                    step="0.0001"
                    min="0"
                    max="1"
                    defaultValue="0"
                    className={labInputClass}
                  />
                </LabField>
                <LabField label="职责份额 r（0–1）">
                  <input
                    name={`share-r-${id}`}
                    type="number"
                    step="0.0001"
                    min="0"
                    max="1"
                    defaultValue="0"
                    className={labInputClass}
                  />
                </LabField>
                <Button
                  size="sm"
                  variant="neutral-primary"
                  onClick={() => setShares((rows) => rows.filter((row) => row !== id))}
                >
                  删除成员参数
                </Button>
              </div>
            ))}
            <Button size="sm" variant="neutral-primary" onClick={() => setShares((rows) => [...rows, uuidv4()])}>
              添加成员参数
            </Button>
          </fieldset>
          <label className="flex items-center gap-2 text-13">
            <input type="checkbox" checked={upgraded} onChange={(event) => setUpgraded(event.target.checked)} />
            升级项目，冻结历史孵化资格
          </label>
          {upgraded && (
            <fieldset className="space-y-3 rounded border border-subtle p-3">
              <legend className="text-13 font-medium">历史奖励资格（须提供凭证）</legend>
              {history.map((id) => (
                <div key={id} className="grid grid-cols-2 gap-2">
                  <LabField label="历史成员">
                    <select name={`history-user-${id}`} required className={labInputClass}>
                      <option value="">请选择</option>
                      {members.map((member) => (
                        <option key={member.value} value={member.value}>
                          {member.label}
                        </option>
                      ))}
                    </select>
                  </LabField>
                  <LabField label="历史有效 VC">
                    <input
                      name={`history-vc-${id}`}
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      className={labInputClass}
                    />
                  </LabField>
                  <LabField label="具体资金来源（与到账来源一致）">
                    <input name={`history-source-${id}`} required className={labInputClass} />
                  </LabField>
                  <LabField label="授权继承的原来源（后续独立来源可选）">
                    <input name={`history-inherit-${id}`} className={labInputClass} />
                  </LabField>
                  <LabField label="继承授权依据（填原来源时必填）">
                    <input name={`history-inherit-basis-${id}`} className={labInputClass} />
                  </LabField>
                  <LabField label="资格形成日期">
                    <input name={`history-date-${id}`} type="date" required className={labInputClass} />
                  </LabField>
                  <LabField label="资格依据">
                    <input name={`history-basis-${id}`} required className={labInputClass} />
                  </LabField>
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    disabled={history.length === 1}
                    onClick={() => setHistory((rows) => rows.filter((row) => row !== id))}
                  >
                    删除历史资格
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="neutral-primary" onClick={() => setHistory((rows) => [...rows, uuidv4()])}>
                添加历史资格
              </Button>
            </fieldset>
          )}
        </>
      )}
      <LabField label="操作／核准依据">
        <textarea name="reason" required rows={3} className={labInputClass} defaultValue={defaults.reason} />
      </LabField>
      <LabField label="凭证或证据引用">
        <textarea
          name="evidence"
          required={
            [
              "receipt",
              "payment",
              "opening",
              "expense",
              "tax-remit",
              "risk-release",
              "risk-use",
              "public-payment",
              "reverse",
            ].includes(action) || upgraded
          }
          rows={2}
          className={labInputClass}
        />
      </LabField>
      <LabField label="事实发生时间（上海，可选）">
        <input type="datetime-local" name="occurred_at" className={labInputClass} />
      </LabField>
    </LabDialog>
  );
}
