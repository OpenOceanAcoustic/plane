/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { newRequestKey as uuidv4 } from "./business";
import type { LabStore } from "./transport";
import { LabDialog, LabField, labInputClass } from "./ui";

export type LabFinanceDeletion = {
  kind: "receipt" | "stage" | "project";
  id: string;
  name: string;
  amount?: string;
  blockedReason?: string;
};

const labels = { receipt: "到账记录", stage: "阶段预算", project: "资金项目" };
const resourceKeys = { receipt: "batch_id", stage: "stage_id", project: "project_id" };

export function LabFinanceDeleteDialog({
  store,
  target,
  onClose,
  onSaved,
}: {
  store: LabStore;
  target: LabFinanceDeletion;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [requestKey] = useState(() => uuidv4());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  return (
    <LabDialog
      title={`删除${labels[target.kind]}`}
      submitLabel={applied ? "刷新记录" : "确认删除"}
      destructive
      busy={saving}
      onClose={onClose}
      error={error || target.blockedReason}
      submitDisabled={Boolean(target.blockedReason)}
      onSubmit={async (form) => {
        setError("");
        setSaving(true);
        let deleted = applied;
        try {
          if (!applied) {
            await store.request(`finance/${target.kind}-delete/`, "POST", {
              [resourceKeys[target.kind]]: target.id,
              request_key: requestKey,
              reason: String(form.get("reason") ?? "").trim(),
              evidence: String(form.get("evidence") ?? "").trim(),
            });
            setApplied(true);
            deleted = true;
          }
          await onSaved();
          onClose();
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "请重试";
          setError(deleted ? `删除已完成，刷新记录失败：${message}` : message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <article className="lab-card">
        <h3>
          {target.name}
          {target.amount !== undefined ? ` · ¥${target.amount}` : ""}
        </h3>
      </article>
      <LabField label="删除原因">
        <textarea name="reason" required rows={2} readOnly={applied} className={labInputClass} />
      </LabField>
      {target.kind === "receipt" && (
        <LabField label="凭证">
          <input name="evidence" readOnly={applied} className={labInputClass} />
        </LabField>
      )}
    </LabDialog>
  );
}
