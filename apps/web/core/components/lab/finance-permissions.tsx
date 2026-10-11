/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from "react";
import type { LabFinancePermission, LabFinancePermissionMembers } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog } from "@plane/ui";
const permissions: { value: LabFinancePermission; label: string }[] = [
  { value: "view", label: "查看" },
  { value: "record", label: "登记资金" },
  { value: "approve", label: "核准奖励" },
  { value: "pay", label: "登记付款" },
];
export function FinancePermissionDialog({
  store,
  projectId,
  onClose,
  onSaved,
}: {
  store: LabStore;
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [data, setData] = useState<LabFinancePermissionMembers>();
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<LabFinancePermission[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = store.request;
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await request<LabFinancePermissionMembers>(
          `finance/permissions/?project_id=${encodeURIComponent(projectId)}`
        );
        if (active) setData(result);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "加载失败");
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [request, projectId]);
  return (
    <LabDialog
      title="财务权限"
      onClose={onClose}
      busy={busy}
      error={error}
      submitDisabled={!selected || !data}
      onSubmit={async () => {
        setBusy(true);
        setError("");
        try {
          const result = await store.request<LabFinancePermissionMembers>("finance/permissions/", "POST", {
            project_id: projectId,
            user_id: selected,
            permissions: values,
          });
          setData(result);
          await onSaved();
          onClose();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "保存失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div role="group" aria-label="项目成员">
        {data?.members.map((member) => (
          <Button
            key={member.id}
            disabled={member.owner || busy}
            aria-pressed={selected === member.id}
            onClick={() => {
              setSelected(member.id);
              setValues(member.permissions);
            }}
          >
            {member.name}
            {member.owner ? " · 全部权限" : ""}
          </Button>
        ))}
        {data && !data.members.some((member) => !member.owner) && <p>暂无可授权成员</p>}
      </div>
      {selected && (
        <div role="group" aria-label="操作权限">
          {permissions.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.includes(value)}
                disabled={busy}
                onChange={(event) => {
                  if (event.target.checked) setValues((current) => [...new Set([...current, "view" as const, value])]);
                  else setValues((current) => (value === "view" ? [] : current.filter((entry) => entry !== value)));
                }}
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </LabDialog>
  );
}
