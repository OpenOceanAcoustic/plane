/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";

export const LabIssueDeleteDialog = observer(function LabIssueDeleteDialog({
  store,
  task,
  onClose,
  onDeleted,
}: {
  store: LabStore;
  task: { id: string; title: string; bounty_id?: string | null };
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    store.error = "";
    return () => {
      active.current = false;
    };
  }, [store, task.id]);
  return (
    <LabDialog
      title="删除工作项"
      submitLabel="删除"
      destructive
      busy={store.busy}
      error={store.error}
      onClose={onClose}
      onSubmit={(data) =>
        store.execute(async () => {
          await store.request(`tasks/${encodeURIComponent(task.id)}/`, "DELETE", {
            reason: String(data.get("reason") ?? "").trim(),
          });
          if (!active.current) return;
          onClose();
          await onDeleted();
          window.dispatchEvent(new Event("focus"));
        })
      }
    >
      <p className="text-13">确认删除“{task.title}”？</p>
      <LabField label="删除原因">
        <textarea className={labInputClass} name="reason" required={Boolean(task.bounty_id)} maxLength={4000} />
      </LabField>
    </LabDialog>
  );
});
