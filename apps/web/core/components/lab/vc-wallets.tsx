/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { v4 as uuidv4 } from "uuid";
import type { LabBountyBudget, LabVCQuotas } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabAmountInput, LabDialog, LabField, labAmountError, labInputClass } from "@plane/ui";

export const LabVCWallets = observer(function LabVCWallets({
  store,
  onClose,
}: {
  store: LabStore;
  onClose: () => void;
}) {
  const [budgets, setBudgets] = useState<LabBountyBudget[]>([]);
  const [projectId, setProjectId] = useState("");
  const [quotas, setQuotas] = useState<LabVCQuotas>();
  const [memberId, setMemberId] = useState("");
  const [kind, setKind] = useState<"grant" | "reclaim">("grant");
  const [amount, setAmount] = useState("");
  const [key, setKey] = useState(() => uuidv4());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const source = budgets.find((row) => row.project_id === projectId);
  const member = quotas?.members.find((row) => row.id === memberId);
  const limit = kind === "grant" ? source?.available : (member?.reclaimable ?? member?.wallet.project_available);
  const amountError = labAmountError(amount, { limit, min: "0.01", unit: "VC" });

  useEffect(() => {
    let current = true;
    void store
      .request<LabBountyBudget[]>("bounties/budgets/")
      .then((rows) => {
        if (current) {
          setBudgets(rows);
          setProjectId(rows.find((row) => !row.deleted)?.project_id ?? "");
        }
        return rows;
      })
      .catch((failure: unknown) => {
        if (current) setError(failure instanceof Error ? failure.message : "VC 余额读取失败");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [store]);

  useEffect(() => {
    let current = true;
    setQuotas(undefined);
    setMemberId("");
    if (projectId && (!source?.can_allocate || source.deleted)) setLoading(false);
    if (source?.can_allocate && !source.deleted) {
      setLoading(true);
      void store
        .request<LabVCQuotas>(`bounties/quotas/${projectId}/`)
        .then((rows) => {
          if (current) setQuotas(rows);
          return rows;
        })
        .catch((failure: unknown) => {
          if (current) setError(failure instanceof Error ? failure.message : "成员额度读取失败");
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }
    return () => {
      current = false;
    };
  }, [store, projectId, source?.can_allocate, source?.deleted]);

  async function refresh() {
    const rows = await store.request<LabBountyBudget[]>("bounties/budgets/");
    setBudgets(rows);
    if (rows.find((row) => row.project_id === projectId)?.can_allocate)
      setQuotas(await store.request<LabVCQuotas>(`bounties/quotas/${projectId}/`));
  }

  return (
    <LabDialog
      title="我的 VC"
      busy={busy}
      error={error}
      onClose={onClose}
      submitLabel={kind === "grant" ? "分配额度" : "收回额度"}
      submitDisabled={loading || !!amountError || !member || !source?.configured || !!source.deleted}
      onSubmit={
        source?.can_allocate && !source.deleted
          ? async (data) => {
              setBusy(true);
              setError("");
              setSuccess("");
              try {
                await store.request(`bounties/quotas/${projectId}/`, "POST", {
                  user_id: memberId,
                  stage_id: source.stage_id,
                  kind,
                  amount,
                  reason: data.get("reason"),
                  request_key: key,
                });
                setKey(uuidv4());
                setAmount("");
                await refresh();
                setSuccess(kind === "grant" ? "额度已分配" : "额度已收回");
              } catch (failure) {
                try {
                  await refresh();
                } catch {
                  /* Retain the operation failure. */
                }
                throw failure;
              } finally {
                setBusy(false);
              }
            }
          : undefined
      }
    >
      <LabField label="项目">
        <select
          className={labInputClass}
          value={projectId}
          disabled={busy}
          onChange={(event) => {
            setProjectId(event.target.value);
            setAmount("");
            setError("");
            setSuccess("");
            setKey(uuidv4());
          }}
        >
          <option value="">请选择项目</option>
          {budgets.map((row) => (
            <option key={row.project_id} value={row.project_id}>
              {row.project}
            </option>
          ))}
        </select>
      </LabField>
      {loading && <p role="status">正在加载 VC 余额</p>}
      {source?.wallet && (
        <dl className="grid grid-cols-2 gap-2 text-13" aria-label="我的 VC 余额">
          <dt>项目分配可用 VC</dt>
          <dd>{source.wallet.project_available}</dd>
          <dt>悬赏收入可用 VC</dt>
          <dd>{source.wallet.earned_available}</dd>
          <dt>合计可用 VC</dt>
          <dd>{source.wallet.available}</dd>
          {source.wallet.earned_debt !== "0.00" && (
            <>
              <dt>收入待抵扣 VC</dt>
              <dd>{source.wallet.earned_debt}</dd>
            </>
          )}
        </dl>
      )}
      {!loading && !budgets.length && <p>暂无项目</p>}
      {source?.can_allocate && !source.deleted && (
        <>
          <h3 className="text-14 font-semibold">成员额度</h3>
          <p className="text-13">项目未分配 VC：{source.available ?? "未配置预算"}</p>
          <LabField label="成员">
            <select
              className={labInputClass}
              value={memberId}
              required
              disabled={busy || loading}
              onChange={(event) => {
                setMemberId(event.target.value);
                setAmount("");
                setSuccess("");
                setKey(uuidv4());
              }}
            >
              <option value="">请选择成员</option>
              {quotas?.members.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          {member && <p className="text-13">成员项目额度余额：{member.wallet.project_available} VC</p>}
          <LabField label="额度操作">
            <select
              className={labInputClass}
              value={kind}
              disabled={busy}
              onChange={(event) => {
                setKind(event.target.value as "grant" | "reclaim");
                setAmount("");
                setSuccess("");
                setKey(uuidv4());
              }}
            >
              <option value="grant">分配</option>
              <option value="reclaim">收回</option>
            </select>
          </LabField>
          <LabField label="额度 VC">
            <LabAmountInput
              aria-label="额度 VC"
              className={labInputClass}
              min="0.01"
              limit={limit}
              unit="VC"
              step="0.01"
              value={amount}
              onValueChange={setAmount}
              required
            />
          </LabField>
          <LabField label="原因">
            <textarea name="reason" className={labInputClass} maxLength={4000} required />
          </LabField>
          {quotas && quotas.history.length > 0 && (
            <details>
              <summary>额度记录</summary>
              <ul className="mt-2 space-y-2 text-13">
                {quotas.history.map((row) => (
                  <li key={row.id}>
                    {row.name} · {row.delta} VC · {row.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {success && <p role="status">{success}</p>}
    </LabDialog>
  );
});
