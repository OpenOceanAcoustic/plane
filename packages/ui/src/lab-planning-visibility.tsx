/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { ComponentType, SelectHTMLAttributes } from "react";
import type { LabItem, LabMember, LabPlanningVisibility } from "@plane/types";
import { LabField, labInputClass } from "./lab-form";

const labels: Record<LabPlanningVisibility, string> = {
  private: "仅自己可见",
  organization: "组织内可见",
  selected: "指定成员可见",
  leads: "负责人可见（原设置）",
  project: "项目成员可见",
};
export function labPlanningVisibilityLabel(item: Pick<LabItem, "visibility" | "public">) {
  return labels[item.visibility ?? (item.public ? "leads" : "private")];
}
export function LabPlanningVisibilityFields({
  item,
  members = [],
  SelectComponent = "select",
}: {
  item?: LabItem;
  members?: LabMember[];
  SelectComponent?: ComponentType<SelectHTMLAttributes<HTMLSelectElement>> | "select";
}) {
  const [visibility, setVisibility] = useState(item?.visibility ?? (item?.public ? "leads" : "private"));
  return (
    <>
      <LabField label="可见范围">
        <SelectComponent
          className={labInputClass}
          name="visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as LabPlanningVisibility)}
        >
          {(
            [
              "private",
              "organization",
              "selected",
              ...(item?.visibility === "leads" || (!item?.visibility && item?.public) ? ["leads"] : []),
            ] as LabPlanningVisibility[]
          ).map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </SelectComponent>
      </LabField>
      {visibility === "selected" && (
        <fieldset className="space-y-2">
          <legend>可见成员</legend>
          {members.length ? (
            members.map((member) => (
              <label key={member.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="shared_user_ids"
                  value={member.id}
                  defaultChecked={item?.shared_user_ids?.includes(member.id)}
                />
                {member.name}
              </label>
            ))
          ) : (
            <p>暂无其他成员</p>
          )}
        </fieldset>
      )}
    </>
  );
}
