/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import useSWR from "swr";
import { v4 as uuidv4 } from "uuid";
import type { LabProjectBudgetCategory, LabProjectBudgetItem, LabProjectBudgetReport } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, labDecimalText, labDecimalUnits, labInputClass } from "@plane/ui";

const categories: { value: LabProjectBudgetCategory; label: string }[] = [
  { value: "labor", label: "劳务费" },
  { value: "travel", label: "差旅费" },
  { value: "outsourcing", label: "外协费" },
  { value: "equipment", label: "设备费" },
  { value: "other", label: "其他费用" },
];
type BudgetDraftItem = LabProjectBudgetItem & { rowId: string };
const initialItems = (): BudgetDraftItem[] =>
  categories
    .slice(0, 4)
    .map(({ value, label }) => ({ rowId: uuidv4(), category: value, name: label, amount: "0.00", note: "" }));
const maxUnits = 99999999999999n;
const amountValid = (value: string) => /^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(value);

export function LabProjectBudget({ store, projectId }: { store: LabStore; projectId: string }) {
  const path = `finance/project-budgets/${projectId}/`;
  const { data, error, isLoading, mutate } = useSWR(["lab-project-cost-budget", store.slug, projectId], () =>
    store.request<LabProjectBudgetReport>(path)
  );
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<BudgetDraftItem[]>(initialItems);
  const [reason, setReason] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [requestKey, setRequestKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [conflict, setConflict] = useState(false);
  const latest = data?.versions[0];
  const report = data?.versions.find((version) => version.version === selectedVersion) ?? latest;
  const displayedItems = editing
    ? items
    : (report?.items.map((row, index) => ({ ...row, rowId: `${report.id}-${index}` })) ?? []);
  const totalUnits = displayedItems.reduce((sum, row) => sum + (labDecimalUnits(row.amount) ?? 0n), 0n);
  const valid =
    items.length > 0 &&
    items.length <= 100 &&
    totalUnits <= maxUnits &&
    reason.trim() &&
    items.every((row) => row.name.trim() && amountValid(row.amount));
  const change = (index: number, patch: Partial<LabProjectBudgetItem>) => {
    setItems((current) =>
      current.map((item, position) => {
        if (position !== index) return item;
        const next = { ...item, ...patch };
        if (next.quantity !== undefined && ("quantity" in patch || "unit_price" in patch || "unit" in patch)) {
          const quantity = labDecimalUnits(next.quantity),
            price = labDecimalUnits(next.unit_price ?? "");
          next.amount = quantity === null || price === null ? "" : labDecimalText((quantity * price + 50n) / 100n);
          next.note = `${next.quantity}${next.unit ?? ""} × ${next.unit_price ?? ""}元／${next.unit ?? "项"}`;
        }
        return next;
      })
    );
    setRequestKey(uuidv4());
  };
  const begin = () => {
    setItems(latest ? latest.items.map((row) => ({ ...row, rowId: uuidv4() })) : initialItems());
    setExpectedVersion(latest?.version ?? 0);
    setReason("");
    setFailure("");
    setConflict(false);
    setRequestKey(uuidv4());
    setEditing(true);
  };
  const save = async () => {
    if (!valid || busy || conflict) return;
    setBusy(true);
    setFailure("");
    try {
      await store.request(path, "POST", {
        items: items.map(({ rowId: _rowId, ...item }) => item),
        reason,
        expected_version: expectedVersion,
        request_key: requestKey,
      });
      setEditing(false);
      setSelectedVersion(undefined);
      await mutate();
    } catch (problem) {
      setFailure(problem instanceof Error ? problem.message : "保存预算失败");
      // Refresh the server version while retaining this draft; the user explicitly reloads before editing again.
      try {
        const fresh = await mutate();
        if ((fresh?.versions[0]?.version ?? 0) !== expectedVersion) setConflict(true);
      } catch {
        /* Preserve the original failure and draft when offline. */
      }
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    if (!report) return;
    setBusy(true);
    setFailure("");
    try {
      const { blob } = await store.download(`${path}?format=csv&version=${report.version}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `project-budget-v${report.version}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) {
      setFailure(problem instanceof Error ? problem.message : "导出预算失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="项目启动预算" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-16 font-semibold">项目启动预算</h2>
        {editing && (
          <span role="status" className="text-13 text-secondary">
            未保存
          </span>
        )}
        {!editing && !!data?.versions.length && (
          <select
            aria-label="预算版本"
            className={`${labInputClass} max-w-72`}
            value={report?.version}
            disabled={busy}
            onChange={(event) => setSelectedVersion(Number(event.target.value))}
          >
            {data.versions.map((version) => (
              <option key={version.id} value={version.version}>
                V{version.version} · {version.actor} ·{" "}
                {new Date(version.created_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}
              </option>
            ))}
          </select>
        )}
        {!editing && report && (
          <Button size="sm" variant="neutral-primary" disabled={busy} onClick={() => void download()}>
            导出 CSV
          </Button>
        )}
        {!editing && data?.can_edit && (
          <Button size="sm" variant="primary" disabled={busy} onClick={begin}>
            {latest ? "调整预算" : "编制预算"}
          </Button>
        )}
      </div>
      {isLoading && <p className="text-13 text-secondary">正在读取项目预算…</p>}
      {(error || failure) && (
        <p role="alert" className="text-13 text-danger-primary">
          {failure || (error instanceof Error ? error.message : "项目预算加载失败")}
        </p>
      )}
      {conflict && (
        <div role="alert" className="flex items-center gap-2 text-13">
          预算已有新版本
          <Button size="sm" variant="neutral-primary" onClick={begin} disabled={busy}>
            重新载入最新预算
          </Button>
        </div>
      )}
      {!editing && data && !report && <p className="text-13 text-secondary">尚未编制项目启动预算</p>}
      {(editing || report) && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            {categories.map(({ value, label }) => (
              <dl key={value} className="rounded-lg border border-subtle bg-layer-2 p-3">
                <dt className="text-13 text-secondary">{label}</dt>
                <dd className="lab-finance-figure mt-1 text-16">
                  ¥
                  {labDecimalText(
                    displayedItems
                      .filter((row) => row.category === value)
                      .reduce((sum, row) => sum + (labDecimalUnits(row.amount) ?? 0n), 0n)
                  )}
                </dd>
              </dl>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-subtle">
            <table className="w-full text-left text-13">
              <thead className="bg-layer-2">
                <tr>
                  {["费用类别", "费用项目", "预算金额（元）", "测算依据", ...(editing ? ["操作"] : [])].map((label) => (
                    <th key={label} className="px-3 py-2 font-medium whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedItems.map((row, index) => (
                  <tr key={row.rowId} className="border-t border-subtle">
                    <td className="min-w-32 px-3 py-2">
                      {editing ? (
                        <select
                          aria-label={`第${index + 1}项费用类别`}
                          className={labInputClass}
                          value={row.category}
                          disabled={busy}
                          onChange={(event) =>
                            change(index, { category: event.target.value as LabProjectBudgetCategory })
                          }
                        >
                          {categories.map(({ value, label }) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        categories.find((entry) => entry.value === row.category)?.label
                      )}
                    </td>
                    <td className="min-w-36 px-3 py-2">
                      {editing ? (
                        <input
                          aria-label={`第${index + 1}项费用项目`}
                          className={labInputClass}
                          value={row.name}
                          maxLength={120}
                          disabled={busy}
                          onChange={(event) => change(index, { name: event.target.value })}
                        />
                      ) : (
                        row.name
                      )}
                    </td>
                    <td className="min-w-40 px-3 py-2">
                      {editing ? (
                        <>
                          <select
                            aria-label={`第${index + 1}项计价方式`}
                            className={labInputClass}
                            value={row.quantity === undefined ? "amount" : "calculation"}
                            disabled={busy}
                            onChange={(event) => {
                              if (event.target.value === "calculation")
                                change(index, {
                                  quantity: "1",
                                  unit_price: row.amount,
                                  unit: row.category === "labor" ? "小时" : "项",
                                });
                              else {
                                setItems((current) =>
                                  current.map((item, position) => {
                                    if (position !== index) return item;
                                    const { quantity: _quantity, unit_price: _price, unit: _unit, ...rest } = item;
                                    return rest;
                                  })
                                );
                                setRequestKey(uuidv4());
                              }
                            }}
                          >
                            <option value="amount">直接填写金额</option>
                            <option value="calculation">数量 × 单价</option>
                          </select>
                          {row.quantity !== undefined && (
                            <div className="my-2 grid grid-cols-3 gap-2">
                              <label className="text-12">
                                数量
                                <input
                                  aria-label={`第${index + 1}项数量`}
                                  className={labInputClass}
                                  value={row.quantity}
                                  inputMode="decimal"
                                  disabled={busy}
                                  onChange={(event) => change(index, { quantity: event.target.value })}
                                />
                              </label>
                              <label className="text-12">
                                单价（元）
                                <input
                                  aria-label={`第${index + 1}项单价`}
                                  className={labInputClass}
                                  value={row.unit_price ?? ""}
                                  inputMode="decimal"
                                  disabled={busy}
                                  onChange={(event) => change(index, { unit_price: event.target.value })}
                                />
                              </label>
                              <label className="text-12">
                                单位
                                <input
                                  aria-label={`第${index + 1}项单位`}
                                  className={labInputClass}
                                  value={row.unit ?? ""}
                                  maxLength={20}
                                  disabled={busy}
                                  onChange={(event) => change(index, { unit: event.target.value })}
                                />
                              </label>
                            </div>
                          )}
                          <input
                            aria-label={`第${index + 1}项预算金额`}
                            type="text"
                            inputMode="decimal"
                            className={labInputClass}
                            value={row.amount}
                            maxLength={15}
                            disabled={busy}
                            readOnly={row.quantity !== undefined}
                            aria-invalid={!amountValid(row.amount)}
                            onChange={(event) => change(index, { amount: event.target.value })}
                          />
                          {!amountValid(row.amount) && (
                            <span role="alert" className="text-danger-primary">
                              请输入非负金额，最多12位整数及2位小数
                            </span>
                          )}
                        </>
                      ) : (
                        row.amount
                      )}
                    </td>
                    <td className="min-w-48 px-3 py-2 break-words">
                      {editing ? (
                        <input
                          aria-label={`第${index + 1}项测算依据`}
                          className={labInputClass}
                          value={row.note}
                          maxLength={1000}
                          disabled={busy}
                          onChange={(event) => change(index, { note: event.target.value })}
                        />
                      ) : (
                        row.note || "—"
                      )}
                    </td>
                    {editing && (
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="neutral-primary"
                          aria-label={`删除第${index + 1}项`}
                          disabled={busy || items.length === 1}
                          onClick={() => {
                            setItems(items.filter((_, position) => position !== index));
                            setRequestKey(uuidv4());
                          }}
                        >
                          删除
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-subtle bg-layer-2">
                  <th colSpan={2} className="px-3 py-3">
                    预算合计（元）
                  </th>
                  <td className="lab-finance-figure px-3 py-3" aria-label="预算合计">
                    {labDecimalText(totalUnits)}
                  </td>
                  <td colSpan={editing ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
          {editing ? (
            <>
              {totalUnits > maxUnits && (
                <p role="alert" className="text-13 text-danger-primary">
                  预算合计超出金额上限
                </p>
              )}
              <Button
                size="sm"
                variant="neutral-primary"
                disabled={busy || items.length >= 100}
                onClick={() => {
                  setItems([...items, { rowId: uuidv4(), category: "other", name: "", amount: "0.00", note: "" }]);
                  setRequestKey(uuidv4());
                }}
              >
                添加费用明细
              </Button>
              <label className="block space-y-1 text-13">
                编制／调整说明
                <textarea
                  aria-label="编制／调整说明"
                  className={labInputClass}
                  value={reason}
                  maxLength={2000}
                  disabled={busy}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setRequestKey(uuidv4());
                  }}
                />
              </label>
              <div className="lab-management-footer">
                <strong className="mr-auto text-14">预算合计：{labDecimalText(totalUnits)} 元</strong>
                <Button size="sm" variant="primary" disabled={!valid || busy || conflict} onClick={() => void save()}>
                  {busy ? "保存中…" : "保存预算"}
                </Button>
                <Button
                  size="sm"
                  variant="neutral-primary"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("放弃未保存的预算修改？")) return;
                    setEditing(false);
                    setFailure("");
                    setConflict(false);
                  }}
                >
                  取消
                </Button>
              </div>
            </>
          ) : (
            report && (
              <dl className="space-y-1 text-13 text-secondary">
                <div>
                  <dt className="inline">编制人：</dt>
                  <dd className="inline">{report.actor}</dd>
                </div>
                <div>
                  <dt className="inline">编制时间：</dt>
                  <dd className="inline">
                    {new Date(report.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                  </dd>
                </div>
                <div>
                  <dt className="inline">编制／调整说明：</dt>
                  <dd className="inline">{report.reason}</dd>
                </div>
              </dl>
            )
          )}
        </>
      )}
    </section>
  );
}
