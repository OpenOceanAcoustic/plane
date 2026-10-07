/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@plane/ui";
import type { LabEvent, LabItem } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";
import { calendarInstant, dayLayout, dropInstant, eventSegment, localInput, SLOT_MS, weekDays } from "./calendar-time";

const displayDay = (day: Date) =>
  day.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", weekday: "short" });
const clock = (instant: string) =>
  new Date(instant).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" });

export const LabCalendar = observer(function LabCalendar({
  store,
  team = false,
  scheduled,
  clearScheduled,
}: {
  store: LabStore;
  team?: boolean;
  scheduled?: LabItem;
  clearScheduled: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<LabEvent | "new">();
  const [initialStart, setInitialStart] = useState(new Date(Math.ceil(Date.now() / SLOT_MS) * SLOT_MS));
  const [split, setSplit] = useState(false);
  const days = weekDays(offset);
  const start = days[0]!.toISOString(),
    end = new Date(days[6]!.getTime() + 86400000).toISOString();
  const reload = useCallback(() => store.loadCalendar(start, end, team), [store, start, end, team]);
  useEffect(() => {
    void store.execute(reload);
  }, [store, reload]);
  useEffect(() => {
    if (scheduled) {
      setEditing("new");
      setInitialStart(new Date(Math.ceil(Date.now() / SLOT_MS) * SLOT_MS));
    }
  }, [scheduled]);
  const close = () => {
    setEditing(undefined);
    setSplit(false);
    clearScheduled();
  };
  const editingEvent = editing && editing !== "new" ? editing : undefined;
  async function save(data: FormData) {
    await store.execute(async () => {
      const path = editingEvent ? `calendar/${editingEvent.id}/` : "calendar/";
      const body = split
        ? { split_at: calendarInstant(String(data.get("split_at"))) }
        : {
            item_id: data.get("item_id"),
            start: calendarInstant(String(data.get("start"))),
            end: calendarInstant(String(data.get("end"))),
          };
      const result = await store.request<{ overlap?: boolean }>(path, editingEvent ? "PATCH" : "POST", body);
      store.notice = result.overlap ? "已保存；与已有排期重叠，请确认投入安排。" : "排期已保存";
      await reload();
      close();
    });
  }
  async function dropped(day: Date, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const when = dropInstant(day, (event.clientY - rect.top) / rect.height);
    const block = store.events.find((row) => row.id === event.dataTransfer.getData("lab-block"));
    if (block?.editable) {
      await store.execute(async () => {
        const duration = new Date(block.end).getTime() - new Date(block.start).getTime();
        const resize = event.dataTransfer.getData("lab-resize") === "end";
        const result = await store.request<{ overlap: boolean }>(`calendar/${block.id}/`, "PATCH", {
          start: resize ? block.start : when.toISOString(),
          end: new Date(when.getTime() + (resize ? SLOT_MS : duration)).toISOString(),
        });
        store.notice = result.overlap ? "已移动，存在排期重叠。" : "已移动";
        await reload();
      });
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays size={18} />
        <h2 className="mr-auto text-16 font-medium">{team ? "团队排期" : "个人周历"}</h2>
        <Button size="sm" variant="neutral-primary" onClick={() => setOffset(offset - 1)} aria-label="上一周">
          <ChevronLeft size={16} />
        </Button>
        <Button size="sm" variant="neutral-primary" onClick={() => setOffset(0)}>
          本周
        </Button>
        <Button size="sm" variant="neutral-primary" onClick={() => setOffset(offset + 1)} aria-label="下一周">
          <ChevronRight size={16} />
        </Button>
        {!team && (
          <Button
            size="sm"
            onClick={() => {
              setEditing("new");
              setInitialStart(new Date(Math.ceil(Date.now() / SLOT_MS) * SLOT_MS));
            }}
            prependIcon={<Plus size={14} />}
          >
            安排时间
          </Button>
        )}
      </div>
      <p className="text-12 text-tertiary">
        {displayDay(days[0]!)} — {displayDay(days[6]!)} · 上海时间 ·{" "}
        {team
          ? "私人或无权限内容仅显示忙碌；成员维护本人安排。"
          : "十五分钟步长，拖动时间块可移动，拖动底边可调整时长，点击可拆分。"}
      </p>
      {team ? (
        <div className="overflow-x-auto rounded-md border border-subtle">
          <table className="w-full min-w-[980px] text-13">
            <thead>
              <tr className="bg-layer-1">
                <th className="p-3 text-left">成员</th>
                {days.map((day) => (
                  <th key={day.toISOString()} className="p-3 text-left">
                    {displayDay(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {store.members.map((member) => (
                <tr key={member.id} className="border-t border-subtle">
                  <th className="p-3 text-left font-medium">{member.name}</th>
                  {days.map((day) => (
                    <td key={day.toISOString()} className="min-w-36 p-2 align-top">
                      {store.events
                        .filter((event) => event.user_id === member.id && eventSegment(event.start, event.end, day))
                        .map((event) => (
                          <div key={event.id} className="mb-2 rounded bg-layer-1 p-2">
                            <span className="text-12 text-secondary">
                              {clock(event.start)}–{clock(event.end)}
                            </span>
                            <p>{event.title}</p>
                          </div>
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="max-h-[650px] overflow-auto rounded-md border border-subtle">
          <div className="min-w-[920px]">
            <div className="sticky top-0 z-20 grid grid-cols-[48px_repeat(7,1fr)] border-b border-subtle bg-surface-1">
              <div />
              {days.map((day) => (
                <div key={day.toISOString()} className="border-l border-subtle p-2 text-center text-13">
                  {displayDay(day)}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[48px_repeat(7,1fr)]">
              <div className="relative h-[960px]">
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={hour} className="absolute right-2 text-11 text-tertiary" style={{ top: hour * 40 }}>
                    {String(hour).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className="relative h-[960px] border-l border-subtle"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, transparent 0, transparent 39px, var(--border-subtle) 39px, var(--border-subtle) 40px)",
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => void dropped(day, event)}
                  onDoubleClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    setInitialStart(dropInstant(day, (event.clientY - rect.top) / rect.height));
                    setEditing("new");
                  }}
                >
                  {dayLayout(store.events, day).map(({ event, top, height, lane, lanes }) => (
                    <div
                      key={event.id}
                      className="absolute min-h-5 overflow-hidden rounded border border-accent-strong/30 bg-accent-primary/10 text-12 text-primary"
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        left: `calc(${(lane * 100) / lanes}% + 3px)`,
                        width: `calc(${100 / lanes}% - 6px)`,
                      }}
                    >
                      <button
                        draggable={event.editable}
                        onDragStart={(drag) => drag.dataTransfer.setData("lab-block", event.id)}
                        onClick={() => {
                          if (event.editable) {
                            setEditing(event);
                            setSplit(false);
                          }
                        }}
                        className="h-full w-full px-1.5 pb-2 text-left"
                        title={`${event.title} ${clock(event.start)}–${clock(event.end)}`}
                      >
                        <strong className="block truncate">{event.title}</strong>
                        <span>
                          {clock(event.start)}–{clock(event.end)}
                        </span>
                      </button>
                      {event.editable && new Date(event.end).getTime() <= day.getTime() + 86400000 && (
                        <button
                          aria-label={`调整 ${event.title} 的结束时间`}
                          draggable
                          onDragStart={(drag) => {
                            drag.stopPropagation();
                            drag.dataTransfer.setData("lab-block", event.id);
                            drag.dataTransfer.setData("lab-resize", "end");
                          }}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-accent-primary/30"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {editing && (
        <LabDialog
          title={split ? "拆分时间块" : editingEvent ? "调整时间块" : "安排个人时间"}
          busy={store.busy}
          onClose={close}
          onSubmit={save}
        >
          {!editingEvent && (
            <LabField label="事项">
              <select name="item_id" className={labInputClass} defaultValue={scheduled?.id} required>
                <option value="">请选择本人事项</option>
                {store.planner?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </LabField>
          )}
          {split ? (
            <LabField label="拆分时间（上海）">
              <input
                name="split_at"
                type="datetime-local"
                step={900}
                className={labInputClass}
                required
                defaultValue={localInput(new Date(new Date(editingEvent!.start).getTime() + SLOT_MS))}
              />
            </LabField>
          ) : (
            <>
              <LabField label="开始（上海）">
                <input
                  name="start"
                  type="datetime-local"
                  step={900}
                  className={labInputClass}
                  required
                  defaultValue={localInput(editingEvent?.start ?? initialStart)}
                />
              </LabField>
              <LabField label="结束（上海）">
                <input
                  name="end"
                  type="datetime-local"
                  step={900}
                  className={labInputClass}
                  required
                  defaultValue={localInput(editingEvent?.end ?? new Date(initialStart.getTime() + 3600000))}
                />
              </LabField>
            </>
          )}
          {editingEvent && (
            <div className="flex gap-2">
              <Button size="sm" variant="neutral-primary" onClick={() => setSplit(!split)}>
                {split ? "调整起止" : "拆分时间块"}
              </Button>
              <Button
                size="sm"
                variant="neutral-primary"
                onClick={() =>
                  void store.execute(async () => {
                    await store.request(`calendar/${editingEvent.id}/`, "DELETE");
                    await reload();
                    close();
                  })
                }
              >
                删除时间块
              </Button>
            </div>
          )}
        </LabDialog>
      )}
    </div>
  );
});
