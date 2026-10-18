/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { LabVCBudgetEntry } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabAmountInput, LabDialog, LabField, labAmountError, labInputClass } from "@plane/ui";

export function LabVCBudgetAdjustment({
  store,
  projectId,
  entry,
  onClose,
  onRefresh,
}: {
  store: LabStore;
  projectId: string;
  entry: LabVCBudgetEntry;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(entry.amount);
  const [key, setKey] = useState(() => uuidv4());
  const [busy, setBusy] = useState(false);
  useEffect(() => setKey(uuidv4()), [entry.revision]);
  const error = labAmountError(amount, { min: entry.minimum, unit: "VC" });
  return (
    <LabDialog
      title="调整 VC 预算"
      busy={busy}
      onClose={onClose}
      submitLabel="保存调整"
      submitDisabled={!!error}
      onSubmit={async (data) => {
        setBusy(true);
        try {
          await store.request(`bounties/budgets/${projectId}/entries/${entry.id}/`, "PATCH", {
            amount,
            expected_revision: entry.revision,
            reason: data.get("reason"),
            request_key: key,
          });
          await onRefresh();
          onClose();
        } catch (failure) {
          try {
            await onRefresh();
          } catch {
            /* Preserve the adjustment failure and draft. */
          }
          throw failure;
        } finally {
          setBusy(false);
        }
      }}
    >
      <dl className="grid grid-cols-2 gap-2 text-13">
        <dt>预算名称</dt>
        <dd>{entry.name}</dd>
        <dt>当前额度 VC</dt>
        <dd>{entry.amount}</dd>
        <dt>最低可保留 VC</dt>
        <dd>{entry.minimum}</dd>
      </dl>
      <LabField label="调整后额度 VC">
        <LabAmountInput
          aria-label="调整后额度 VC"
          min={entry.minimum}
          unit="VC"
          step="0.01"
          className={labInputClass}
          value={amount}
          onValueChange={(value) => {
            setAmount(value);
            setKey(uuidv4());
          }}
          required
        />
      </LabField>
      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          {error}
        </p>
      )}
      <LabField label="调整原因">
        <textarea name="reason" className={labInputClass} required maxLength={4000} />
      </LabField>
    </LabDialog>
  );
}
