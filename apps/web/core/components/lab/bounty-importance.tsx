/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { observer } from "mobx-react";
import { v4 as uuidv4 } from "uuid";
import type { LabBounty } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";

export const LabBountyImportance = observer(function LabBountyImportance({
  store,
  bounty,
  onChanged,
}: {
  store: LabStore;
  bounty: LabBounty;
  onChanged?: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [major, setMajor] = useState(bounty.major);
  const [reviewer, setReviewer] = useState("");
  const [expected, setExpected] = useState(bounty.importance_state);
  const [key, setKey] = useState(() => uuidv4());
  const [busy, setBusy] = useState(false);
  const members = store.planner?.projects.find((row) => row.id === bounty.project_id)?.members ?? [];
  const refresh = async () => {
    await Promise.all([store.loadMarket(), store.loadPlanner()]);
    await onChanged?.();
  };
  if (!bounty.can_change_importance) return null;
  return (
    <>
      <Button
        size="sm"
        variant="neutral-primary"
        onClick={() => {
          setMajor(bounty.major);
          setReviewer(bounty.importance_state?.independent_reviewer_id ?? "");
          setExpected(bounty.importance_state);
          setKey(uuidv4());
          setEditing(true);
        }}
      >
        调整重要级别
      </Button>
      {editing && (
        <LabDialog
          title="调整重要级别"
          busy={busy}
          onClose={() => setEditing(false)}
          submitDisabled={!expected || (major && !reviewer)}
          onSubmit={async () => {
            setBusy(true);
            try {
              await store.request(`bounties/${bounty.id}/importance/`, "POST", {
                major,
                independent_reviewer_id: major ? reviewer : null,
                expected_state: expected,
                request_key: key,
              });
              await refresh();
              setEditing(false);
            } catch (error) {
              try {
                await refresh();
                const latest = store.bounties.find((row) => row.id === bounty.id);
                if (latest?.importance_state) setExpected(latest.importance_state);
                setKey(uuidv4());
              } catch {
                /* Retain the original operation error. */
              }
              throw error;
            } finally {
              setBusy(false);
            }
          }}
        >
          <LabField label="重要级别">
            <select
              className={labInputClass}
              value={major ? "major" : "normal"}
              onChange={(event) => {
                setMajor(event.target.value === "major");
                setKey(uuidv4());
              }}
            >
              <option value="normal">普通</option>
              <option value="major">重大</option>
            </select>
          </LabField>
          {major && (
            <LabField label="复核人">
              <select
                className={labInputClass}
                required
                value={reviewer}
                onChange={(event) => {
                  setReviewer(event.target.value);
                  setKey(uuidv4());
                }}
              >
                <option value="">请选择</option>
                {members
                  .filter((member) => !bounty.allocations.some((row) => row.user_id === member.id && row.approved))
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </LabField>
          )}
        </LabDialog>
      )}
    </>
  );
});
