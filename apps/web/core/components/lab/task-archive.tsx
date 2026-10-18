/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { LabTaskArchivePreview, LabTaskRow } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function LabTaskArchiveDialog({
  store,
  projectId,
  onClose,
  onChanged,
}: {
  store: LabStore;
  projectId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const today = dateFormat.format(new Date());
  const [cutoff, setCutoff] = useState(today);
  const [preview, setPreview] = useState<LabTaskArchivePreview>();
  const [busy, setBusy] = useState(false);
  return (
    <LabDialog
      title="按日期归档"
      onClose={onClose}
      busy={busy}
      submitDisabled={!cutoff || (preview !== undefined && !preview.preview_token)}
      submitLabel={preview ? `归档 ${preview.total} 项` : "预览归档"}
      onSubmit={async () => {
        setBusy(true);
        try {
          if (!preview) {
            setPreview(
              await store.request<LabTaskArchivePreview>("tasks/archive-preview/", "POST", {
                cutoff,
                ...(projectId ? { project_id: projectId } : {}),
              })
            );
          } else {
            try {
              await store.request("tasks/archive/", "POST", { preview_token: preview.preview_token });
            } catch (error) {
              setPreview(undefined);
              throw error;
            }
            await onChanged();
            store.notice = `已归档 ${preview.total} 项工作项`;
            onClose();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <LabField label="完成截止日期（含当天）">
        <input
          type="date"
          aria-label="完成截止日期（含当天）"
          className={labInputClass}
          value={cutoff}
          max={today}
          required
          disabled={busy}
          onChange={(event) => {
            setCutoff(event.target.value);
            setPreview(undefined);
          }}
        />
      </LabField>
      {preview && (
        <section aria-label="待归档工作项" className="space-y-3">
          <p className="text-13">{preview.total ? `${preview.total} 项已完成工作项` : "没有符合条件的工作项"}</p>
          {preview.total > 0 && (
            <ul className="max-h-64 space-y-2 overflow-auto text-13">
              {preview.tasks.map((task) => (
                <li key={task.id} className="rounded border border-subtle p-2">
                  <p>
                    {task.key} · {task.title}
                  </p>
                  <p className="text-secondary">
                    {task.project} · {task.completed_date}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="neutral-primary" disabled={busy} onClick={() => setPreview(undefined)}>
            重新预览
          </Button>
        </section>
      )}
    </LabDialog>
  );
}

export function LabTaskRestoreDialog({
  store,
  task,
  onClose,
  onChanged,
}: {
  store: LabStore;
  task: LabTaskRow;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <LabDialog
      title="恢复工作项"
      submitLabel="恢复"
      busy={busy}
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true);
        try {
          try {
            await store.request(`tasks/${task.id}/restore/`, "POST", { expected_revision: task.revision });
          } catch (error) {
            await onChanged().catch(() => undefined);
            throw error;
          }
          await onChanged();
          store.notice = "工作项已恢复";
          onClose();
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-14">
        {task.key} · {task.title}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-13">
        <dt>完成日期</dt>
        <dd>{task.completed_date ?? "—"}</dd>
        <dt>归档日期</dt>
        <dd>{task.archived_at}</dd>
      </dl>
    </LabDialog>
  );
}
