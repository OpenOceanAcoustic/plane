/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { LabItem } from "@plane/types";
import { labPlanningVisibilityLabel } from "@plane/ui";
import { Button, LabDetail, Empty } from "./ui";

export function SharedPlanning({ items, onClose }: { items: LabItem[]; onClose: () => void }) {
  const [chosen, setChosen] = useState<LabItem>();
  return (
    <LabDetail title={chosen?.title ?? "共享规划"} onClose={onClose}>
      {chosen ? (
        <>
          <p>
            {chosen.owner_name} · {labPlanningVisibilityLabel(chosen)}
          </p>
          {chosen.description && <p className="lab-item-description">{chosen.description}</p>}
          <p>本周计划 {chosen.schedule.week_minutes / 60} 小时</p>
          {chosen.schedule.next_start && (
            <p>
              最近排期 {new Date(chosen.schedule.next_start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            </p>
          )}
          <Button onClick={() => setChosen(undefined)}>返回共享规划</Button>
        </>
      ) : items.length ? (
        items.map((item) => (
          <button type="button" className="lab-card lab-card-row" key={item.id} onClick={() => setChosen(item)}>
            <strong>{item.title}</strong>
            <span>
              {item.owner_name} · {item.category_name ?? "未分类"}
            </span>
          </button>
        ))
      ) : (
        <Empty>暂无共享事项</Empty>
      )}
    </LabDetail>
  );
}
