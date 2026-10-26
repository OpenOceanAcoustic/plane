/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { LabFinanceManagement, LabManagementRecord } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, LabAmountInput, labDecimalUnits, labDecimalText, labInputClass } from "@plane/ui";
import { CostEntryDialog } from "./cost-entry-form";
import { MonthlyPayrollDialog } from "./finance-monthly-payroll";

export type FinanceManagementAction = {
  kind: LabManagementRecord["kind"];
  action: string;
  row?: LabManagementRecord;
  reimbursement?: boolean;
  prefill?: Record<string, string>;
};
const labels: Record<string, string> = {
  funding: "核定项目经费与预算",
  cost: "登记工时与费用",
  payroll: "生成项目工资单",
  audit: "登记财务审计调整",
  recovery: "登记审计追回",
  "reverse-recovery": "冲正追回",
  review: "审核费用",
  pay: "登记实际支付",
  cancel: "撤回记录",
  "reverse-payment": "冲正支付",
};
const cents = (text: string) => labDecimalUnits(text) ?? 0n;

type FinanceDialogProps = {
  store: LabStore;
  path: string;
  data: LabFinanceManagement;
  chosen: FinanceManagementAction;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onAccountAction?: (action: string) => void;
  accountActions?: string[];
};
export function FinanceManagementDialog(props: FinanceDialogProps) {
  const [individualPayroll, setIndividualPayroll] = useState(
    Boolean(props.chosen.prefill?.user_id || props.chosen.prefill?.start || props.chosen.prefill?.end)
  );
  if (props.chosen.kind === "cost" && props.chosen.action === "save")
    return (
      <CostEntryDialog
        store={props.store}
        path={props.path}
        data={props.data}
        row={props.chosen.row}
        reimbursement={props.chosen.reimbursement}
        prefill={props.chosen.prefill}
        onClose={props.onClose}
        onSaved={props.onSaved}
      />
    );
  if (props.chosen.kind === "payroll" && props.chosen.action === "save" && !individualPayroll)
    return (
      <MonthlyPayrollDialog
        store={props.store}
        projectId={props.data.project_id}
        onClose={props.onClose}
        onSaved={props.onSaved}
        onIndividual={() => setIndividualPayroll(true)}
      />
    );
  return <FinanceActionDialog {...props} onMonthly={() => setIndividualPayroll(false)} />;
}
function FinanceActionDialog({
  store,
  path,
  data,
  chosen,
  onClose,
  onSaved,
  onAccountAction,
  accountActions = [],
  onMonthly,
}: FinanceDialogProps & { onMonthly: () => void }) {
  const { kind, action, row } = chosen;
  const [values, setValues] = useState<Record<string, string>>(
    () =>
      ({
        ...(chosen.reimbursement ? { category: "travel" } : {}),
        ...Object.fromEntries(Object.entries(row?.data ?? {}).filter(([, value]) => typeof value === "string")),
        ...chosen.prefill,
      }) as Record<string, string>
  );
  const [requestKey, setRequestKey] = useState(() => uuidv4());
  const [recordId] = useState(() => row?.id ?? (kind === "funding" ? data.funding_id : uuidv4()));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const change = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setRequestKey(uuidv4());
  };
  const input = (
    name: string,
    label: string,
    options?: { value: string; label: string }[],
    type = "text",
    fallback = "",
    required = true
  ) => (
    <LabField key={name} label={required ? label : `${label}（选填）`}>
      {options ? (
        <select
          name={name}
          className={labInputClass}
          required={required}
          value={values[name] ?? fallback}
          onChange={(event) => change(name, event.target.value)}
        >
          <option value="">请选择</option>
          {options.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      ) : type === "amount" ? (
        <LabAmountInput
          name={name}
          aria-label={label}
          value={values[name] ?? fallback}
          onValueChange={(value) => change(name, value)}
          required={required}
          unit={name === "hours" ? "小时" : name === "days" ? "天" : "元"}
        />
      ) : type === "textarea" ? (
        <textarea
          aria-label={label}
          name={name}
          className={labInputClass}
          required={required}
          rows={3}
          maxLength={4000}
          value={values[name] ?? fallback}
          onChange={(event) => change(name, event.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          name={name}
          type={type}
          className={labInputClass}
          required={required}
          maxLength={name === "note" || name === "reason" ? 2000 : 255}
          value={values[name] ?? fallback}
          onChange={(event) => change(name, event.target.value)}
        />
      )}
    </LabField>
  );
  const memberOptions = data.members.map((entry) => ({ value: entry.id, label: entry.name }));
  const paying = action === "pay";
  const account = data.accounts.find((entry) => entry.id === values.account_id);
  const payable = row?.recognized_amount ?? row?.data.amount ?? "0";
  const invalidAmount = Object.entries(values).some(
    ([name, value]) =>
      [
        "funding_amount",
        "budget_amount",
        "hours",
        "rate",
        "actual_amount",
        "days",
        "transport_rate",
        "meal_rate",
        "allowed_amount",
      ].includes(name) &&
      value !== "" &&
      !/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(value)
  );
  return (
    <LabDialog
      title={labels[action] ?? labels[kind]}
      submitLabel={
        paying
          ? "确认登记支付"
          : action === "review"
            ? (values.result ?? "approved") === "approved"
              ? "确认通过"
              : "确认退回"
            : "保存"
      }
      busy={busy}
      error={failure}
      onClose={onClose}
      submitDisabled={invalidAmount || (paying && (!account || cents(payable) > cents(account.available)))}
      onSubmit={async (form) => {
        setBusy(true);
        setFailure("");
        try {
          const fields = Object.fromEntries(form.entries());
          const body = {
            kind,
            action,
            record_id: recordId,
            expected_version: row?.version ?? 0,
            request_key: requestKey,
            reason: String(fields.reason ?? ""),
            data: fields,
          };
          await store.request(path, "POST", body);
          await onSaved();
          onClose();
        } catch (problem) {
          setFailure(problem instanceof Error ? problem.message : "保存失败");
          await onSaved().catch(() => undefined);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        {row && ["review", "pay"].includes(action) && (
          <dl className="rounded-lg border border-subtle bg-layer-2 p-3 text-13">
            <div>成员：{row.data.user_name}</div>
            <div>
              期间：{row.data.start ?? row.data.date} 至 {row.data.end ?? row.data.end_date ?? row.data.date}
            </div>
            {row.data.work && <div className="whitespace-pre-wrap">工作内容：{row.data.work}</div>}
            <div>
              {paying ? "应付" : "申报"}金额：{payable} 元
            </div>
          </dl>
        )}
        {action === "save" && kind === "funding" && (
          <>
            {input("source_type", "项目类型", [
              { value: "external", label: "外部项目（合同）" },
              { value: "internal", label: "内部项目（内部决议）" },
            ])}
            {input("funding_amount", "核定项目经费（元）", undefined, "amount")}
            {input("budget_amount", "核定预算（元）", undefined, "amount")}
            {input("reference", "合同／决议编号", undefined, "text", "", false)}
            {input("basis", "合同／内部决议依据", undefined, "textarea")}
          </>
        )}
        {action === "save" && kind === "payroll" && (
          <>
            <Button size="sm" variant="neutral-primary" onClick={onMonthly}>
              按月批量生成
            </Button>
            {input("user_id", "计薪成员", memberOptions)}
            {input("start", "计薪开始日期", undefined, "date")}
            {input("end", "计薪结束日期", undefined, "date")}
          </>
        )}
        {action === "save" && kind === "audit" && (
          <>
            {input(
              "cost_id",
              "审计成本记录",
              data.records
                .filter((entry) => entry.kind === "cost" && ["approved", "paid"].includes(entry.state))
                .map((entry) => ({
                  value: entry.id,
                  label: `${entry.data.date} · ${entry.data.user_name} · ${entry.data.work} · ${entry.recognized_amount} 元`,
                }))
            )}
            {input("allowed_amount", "审计认定金额（元）", undefined, "amount")}
            {input("finding", "审计问题", undefined, "textarea")}
            {input("evidence", "审计依据", undefined, "textarea")}
          </>
        )}
        {action === "save" && kind === "recovery" && (
          <>
            {input(
              "cost_id",
              "待追回成本",
              data.records
                .filter((entry) => entry.kind === "cost" && cents(entry.recovery_remaining ?? "0") > 0n)
                .map((entry) => ({
                  value: entry.id,
                  label: `${entry.data.user_name} · ${entry.data.work} · 待追回 ${entry.recovery_remaining} 元`,
                }))
            )}
            {input("amount", "本次追回金额（元）", undefined, "amount")}
            {input("reference", "收款流水号")}
            {input("evidence", "追回凭证", undefined, "textarea")}
          </>
        )}
        {action === "review" && (
          <>
            {input(
              "result",
              "审核结果",
              [
                { value: "approved", label: "通过" },
                { value: "rejected", label: "退回修改" },
              ],
              "text",
              "approved"
            )}
            {input("note", "审核意见", undefined, "text", "", false)}
          </>
        )}
        {paying && (
          <>
            {!data.accounts.length && (
              <div role="status" className="space-y-3 rounded-lg border border-subtle p-3">
                <p>暂无可用项目资金账户</p>
                <div className="flex flex-wrap gap-2">
                  {onAccountAction &&
                    accountActions.map((entry) => (
                      <Button key={entry} size="sm" variant="neutral-primary" onClick={() => onAccountAction(entry)}>
                        {entry === "opening" ? "录入期初余额" : "登记真实到账"}
                      </Button>
                    ))}
                </div>
                {!accountActions.length && <p className="text-13 text-secondary">无资金登记权限</p>}
              </div>
            )}
            {input(
              "account_id",
              "项目资金账户",
              data.accounts.map((entry) => ({ value: entry.id, label: `${entry.label} · 可用 ${entry.available} 元` }))
            )}
            {account && cents(payable) > cents(account.available) && (
              <p role="alert" className="text-danger-primary">
                项目可用资金不足：可用 {account.available} 元，尚缺{" "}
                {labDecimalText(cents(payable) - cents(account.available))} 元
              </p>
            )}
            {account && <p className="text-13">账户可用余额：{account.available} 元</p>}
            {!!data.accounts.length && !account && (
              <p role="status" className="text-13 text-secondary">
                请选择项目资金账户
              </p>
            )}
            {input("reference", "支付流水号")}
            {input("evidence", "支付凭证", undefined, "textarea")}
          </>
        )}
        {["reverse-payment", "reverse-recovery"].includes(action) &&
          input("evidence", "冲正凭证", undefined, "textarea")}
        {input("reason", "操作说明", undefined, action === "review" ? "text" : "textarea", "", action !== "review")}
      </fieldset>
    </LabDialog>
  );
}
