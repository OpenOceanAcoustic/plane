/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { LabLaborTeam, LabFinanceManagement } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";

export function LaborTeamDialog({
  store,
  data,
  team,
  onClose,
  onSaved,
}: {
  store: LabStore;
  data: LabFinanceManagement;
  team?: LabLaborTeam;
  onClose: () => void;
  onSaved: (team: LabLaborTeam) => Promise<void>;
}) {
  const [name, setName] = useState(team?.data.name ?? "");
  const [ids, setIds] = useState(
    team?.data.member_ids.filter((id) => data.members.some((member) => member.id === id)) ?? []
  );
  const [recordId] = useState(() => team?.id ?? uuidv4());
  const [key, setKey] = useState(() => uuidv4());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <LabDialog
      title={team ? "编辑团队" : "新建团队"}
      busy={busy}
      error={error}
      onClose={onClose}
      submitDisabled={!ids.length}
      onSubmit={async () => {
        setBusy(true);
        setError("");
        try {
          const saved = await store.request<LabLaborTeam>(`projects/${data.project_id}/labor-teams/`, "POST", {
            record_id: recordId,
            expected_version: team?.version ?? 0,
            request_key: key,
            data: { name, member_ids: ids },
          });
          await onSaved(saved);
        } catch (problem) {
          setError(problem instanceof Error ? problem.message : "团队保存失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="space-y-3">
        <LabField label="团队名称">
          <input
            className={labInputClass}
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setKey(uuidv4());
            }}
          />
        </LabField>
        <h3 className="text-13">团队成员（{ids.length}人）</h3>
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
          {data.members.map((member) => (
            <label key={member.id} className="flex items-center gap-2 text-13">
              <input
                type="checkbox"
                checked={ids.includes(member.id)}
                onChange={(event) => {
                  setIds((current) =>
                    event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id)
                  );
                  setKey(uuidv4());
                }}
              />
              {member.name}
            </label>
          ))}
        </div>
      </fieldset>
    </LabDialog>
  );
}
