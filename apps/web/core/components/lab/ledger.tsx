/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useState } from "react";
import { observer } from "mobx-react";
import type { LabStore } from "@plane/shared-state";
import { Button } from "@plane/ui";

type Entry = {
  id: string;
  created_at: string;
  delta: string;
  bounty_id: string;
  task: { title: string; project: string };
  participant: { name: string };
  actor: string;
  reason: string;
  reverses: string | null;
};

export const LabLedger = observer(function LabLedger({ store, projectId }: { store: LabStore; projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>();
  async function load() {
    setEntries(await store.request<Entry[]>(`ledger/${projectId ? `?project_id=${projectId}` : ""}`));
  }
  async function reverse(entry: Entry) {
    const reason = window.prompt("冲正会追加相反金额的记录，保留原记录。请填写更正原因。");
    if (!reason) return;
    await store.execute(async () => {
      await store.request(`ledger/${entry.id}/reverse/`, "POST", { request_key: crypto.randomUUID(), reason });
      await store.loadMarket();
      await load();
    });
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
                    {Number(entry.delta) > 0 &&
                      !entries.some((row) => row.reverses === entry.id) &&
                      store.bounties.find((row) => row.id === entry.bounty_id)?.is_lead && (
                        <Button size="sm" variant="neutral-primary" onClick={() => void reverse(entry)}>
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
    </section>
  );
});
