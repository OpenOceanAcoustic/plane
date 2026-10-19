/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LabManagementRecord } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog } from "@plane/ui";
export const managementStates: Record<string, string> = {
  submitted: "待核准",
  approved: "已通过",
  rejected: "需修改",
  paid: "已支付",
  ready: "待支付",
  cancelled: "已撤回",
  confirmed: "已核定",
  closed: "已调整",
  received: "已追回",
  draft: "草稿",
};
export const costCategories = [
  { value: "labor", label: "劳务费" },
  { value: "travel", label: "差旅费" },
  { value: "outsourcing", label: "外协费" },
  { value: "equipment", label: "设备费" },
  { value: "other", label: "其他费用" },
];
export function ManagementTable({ headings, children }: { headings: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-subtle">
      <table className="w-full text-left text-13">
        <thead className="bg-layer-2">
          <tr>
            {headings.map((label) => (
              <th className="px-3 py-2 font-medium whitespace-nowrap" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const managementCell = "border-t border-subtle px-3 py-2 align-top";
export function ManagementHistory({
  store,
  path,
  record,
  onClose,
}: {
  store: LabStore;
  path: string;
  record: LabManagementRecord;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<LabManagementRecord[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void store.request<{ history: LabManagementRecord[] }>(`${path}?record_id=${record.id}`).then(
      (result) => {
        if (active) setRows(result.history);
        return undefined;
      },
      (problem: unknown) => {
        if (active) setError(problem instanceof Error ? problem.message : "读取历史失败");
      }
    );
    return () => {
      active = false;
    };
  }, [store, path, record.id]);
  return (
    <LabDialog
      busy={false}
      title="记录历史"
      onClose={onClose}
      onSubmit={async () => onClose()}
      submitLabel="关闭"
      error={error}
    >
      {!rows && !error && <p>正在读取历史…</p>}
      {rows?.map((row) => (
        <article className="space-y-2 rounded border border-subtle p-3 text-13" key={row.version_id}>
          <h3>
            V{row.version} · {managementStates[row.state] ?? row.state} · {row.actor}
          </h3>
          <p>{new Date(row.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
          <p>{row.reason}</p>
          <dl>
            {Object.entries(row.data)
              .filter(
                ([key, value]) =>
                  !key.endsWith("_id") && !key.endsWith("_ids") && typeof value === "string" && key in historyLabels
              )
              .map(([key, value]) => (
                <div className="flex gap-3" key={key}>
                  <dt>{historyLabels[key] ?? key}</dt>
                  <dd className="break-words whitespace-pre-wrap">
                    {key === "category"
                      ? (costCategories.find((entry) => entry.value === value)?.label ?? String(value))
                      : key === "source_type"
                        ? value === "external"
                          ? "外部项目"
                          : "内部项目"
                        : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
          {!!row.data.lines?.length && (
            <ManagementTable headings={["日期", "工作内容", "工时", "单价", "金额"]}>
              {row.data.lines.map((line) => (
                <tr key={line.cost_id}>
                  {Object.entries({
                    date: line.end_date && line.end_date !== line.date ? `${line.date} 至 ${line.end_date}` : line.date,
                    work: line.work,
                    hours: line.hours,
                    rate: line.rate,
                    amount: line.amount,
                  }).map(([key, value]) => (
                    <td className={managementCell} key={key}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </ManagementTable>
          )}
          {!!row.data.assignments?.length && (
            <ManagementTable headings={["成员", "职责分工", "开始日期", "结束日期"]}>
              {row.data.assignments.map((line) => (
                <tr key={line.id ?? `${line.user_id}-${line.start}-${line.work}`}>
                  {Object.entries({ member: line.user_name, work: line.work, start: line.start, end: line.end }).map(
                    ([key, value]) => (
                      <td className={managementCell} key={key}>
                        {value}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </ManagementTable>
          )}
        </article>
      ))}
    </LabDialog>
  );
}
const historyLabels: Record<string, string> = {
  source_type: "经费来源类型",
  funding_amount: "核定经费",
  budget_amount: "核定预算",
  basis: "核定依据",
  reference: "依据编号",
  category: "类别",
  user_name: "成员",
  date: "日期",
  end_date: "结束日期",
  hours_expression: "工时测算",
  team_name: "团队",
  work: "工作内容／事项",
  hours: "工时",
  rate: "工时单价",
  actual_amount: "实际费用",
  days: "出差天数",
  transport_rate: "每日交通补助",
  meal_rate: "每日餐费补助",
  transport: "交通补助",
  meal: "餐费补助",
  amount: "金额",
  evidence: "凭证／依据",
  start: "开始日期",
  end: "结束日期",
  review_note: "审核意见",
  payment_reference: "支付流水号",
  payment_evidence: "支付凭证",
  paid_amount: "实付金额",
  original_amount: "调整前认定金额",
  allowed_amount: "审计认定金额",
  adjustment: "调整差额",
  finding: "审计问题",
  title: "资料名称",
  content: "资料内容",
  requirements: "项目要求",
  technical_route: "技术路径",
  page_name: "关联文档",
};
export async function downloadManagement(store: LabStore, path: string, name: string) {
  const { blob } = await store.download(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
