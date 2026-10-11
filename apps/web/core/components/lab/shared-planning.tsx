/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { LabItem } from "@plane/types";
import { Button, LabDialog, labPlanningVisibilityLabel } from "@plane/ui";

export function LabSharedPlanning({ items }: { items: LabItem[] }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<LabItem>();
  return (
    <>
      <Button
        size="sm"
        variant="neutral-primary"
        onClick={() => {
          setChosen(undefined);
          setOpen(true);
        }}
      >
        共享规划
      </Button>
      {open && (
        <LabDialog title={chosen ? chosen.title : "共享规划"} busy={false} onClose={() => setOpen(false)}>
          {chosen ? (
            <>
              <p>
                {chosen.owner_name} · {labPlanningVisibilityLabel(chosen)}
              </p>
              {chosen.description && <p className="break-words whitespace-pre-wrap">{chosen.description}</p>}
              <p>本周计划 {chosen.schedule.week_minutes / 60} 小时</p>
              {chosen.schedule.next_start && (
                <p>
                  最近排期 {new Date(chosen.schedule.next_start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                </p>
              )}
              <Button variant="neutral-primary" onClick={() => setChosen(undefined)}>
                返回共享规划
              </Button>
            </>
          ) : items.length ? (
            items.map((item) => (
              <button
                type="button"
                className="rounded-lg border border-subtle p-3 text-left hover:bg-layer-1"
                key={item.id}
                onClick={() => setChosen(item)}
              >
                <strong>{item.title}</strong>
                <p>
                  {item.owner_name} · {item.category_name ?? "未分类"}
                </p>
              </button>
            ))
          ) : (
            <p>暂无共享事项</p>
          )}
        </LabDialog>
      )}
    </>
  );
}
