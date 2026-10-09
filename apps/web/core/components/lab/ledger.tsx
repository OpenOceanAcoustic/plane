/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { v4 as uuidv4 } from "uuid";
import type { LabStore } from "@plane/shared-state";
import type { LabLedgerEntry } from "@plane/types";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";

export const LabLedger = observer(function LabLedger({
  store,
  projectId,
  onSaved,
}: {
  store: LabStore;
  projectId: string;
  onSaved?: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<LabLedgerEntry[]>();
  const [chosen, setChosen] = useState<LabLedgerEntry>();
  const [requestKey, setRequestKey] = useState("");
  async function load() {
    setEntries(await store.request<LabLedgerEntry[]>(`ledger/${projectId ? `?project_id=${projectId}` : ""}`));
  }
  return (
    <section className="rounded-lg border border-subtle p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-14 font-semibold">项目贡献账本</h2>
        <Button size="sm" variant="neutral-primary" onClick={() => void store.execute(load)}>
          读取账本
        </Button>
      </div>
      {entries && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-12">
            <thead>
              <tr className="border-b border-subtle">
                <th className="p-2">项目 / 任务快照</th>
                <th>实际参与者</th>
                <th>VC 变化</th>
                <th>验收 / 更正人</th>
                <th>记录原因</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-subtle">
                  <td className="p-2">
                    {entry.task.project}
                    <br />
                    {entry.task.title}
                  </td>
                  <td>{entry.participant.name}</td>
                  <td>
                    {Number(entry.delta) > 0 ? "+" : ""}
                    {entry.delta}
                  </td>
                  <td>{entry.actor}</td>
                  <td>
                    {entry.reason}
                    {entry.reverses ? "（冲正）" : ""}
                  </td>
                  <td>
                    {entry.can_reverse && (
                      <Button
                        size="sm"
                        variant="neutral-primary"
                        onClick={() => {
                          setChosen(entry);
                          setRequestKey(uuidv4());
                        }}
                      >
                        冲正
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="p-4 text-tertiary">尚无验收贡献记录。</p>}
        </div>
      )}
      {chosen && (
        <LabDialog
          title="贡献冲正"
          busy={store.busy}
          onClose={() => setChosen(undefined)}
          onSubmit={(form) =>
            store.execute(async () => {
              await store.request(`ledger/${chosen.id}/reverse/`, "POST", {
                request_key: requestKey,
                reason: form.get("reason"),
              });
              await store.loadMarket();
              await load();
              await onSaved?.();
              setChosen(undefined);
            })
          }
        >
          <p className="text-13">
            为 {chosen.participant.name} 追加 −{chosen.delta} VC 的更正记录，并保留原记录。
          </p>
          <LabField label="更正原因">
            <textarea name="reason" className={labInputClass} rows={4} required />
          </LabField>
          {store.error && (
            <p role="alert" className="text-12 text-danger-primary">
              {store.error}
            </p>
          )}
        </LabDialog>
      )}
    </section>
  );
});
