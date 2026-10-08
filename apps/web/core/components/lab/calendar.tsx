/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import FullCalendar from "@fullcalendar/react";
import type {
  CalendarRef,
  DatesSetInfo,
  EventDropInfo,
  EventResizeDoneInfo,
  DateSelectInfo,
  EventInput,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/monarch";
import zhCN from "@fullcalendar/react/locales/zh-cn";
import resourceTimelinePlugin from "@fullcalendar/react-scheduler/resource-timeline";
import resourceTimeGridPlugin from "@fullcalendar/react-scheduler/resource-timegrid";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { Button, LabDialog, LabField, LabSelect, labInputClass } from "@plane/ui";
import type { LabEvent, LabItem, LabMember } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { calendarInstant, localInput, SLOT_MS, weekDays } from "./calendar-time";
// oxlint-disable-next-line import/no-unassigned-import -- bundled FullCalendar layout styles
import "@fullcalendar/react/skeleton.css";
// oxlint-disable-next-line import/no-unassigned-import -- local theme, no CDN
import "@fullcalendar/react/themes/monarch/theme.css";
// oxlint-disable-next-line import/no-unassigned-import -- Plane theme token adaptation
import "./calendar.css";

const plugins = [
  themePlugin,
  dayGridPlugin,
  timeGridPlugin,
  interactionPlugin,
  resourceTimelinePlugin,
  resourceTimeGridPlugin,
];
const personalViews = [
  { value: "timeGridDay", label: "日" },
  { value: "timeGridWeek", label: "周" },
  { value: "dayGridMonth", label: "月" },
];
const teamViews = [
  { value: "resourceTimelineWeek", label: "人员时间轴" },
  { value: "resourceTimeGridWeek", label: "人员分列" },
];
const clock = (instant: string) =>
  new Date(instant).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" });
const roundedNow = () => new Date(Math.ceil(Date.now() / SLOT_MS) * SLOT_MS);
const csvCell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
function exportEvents(events: LabEvent[], members: LabMember[], format: "csv" | "json") {
  const names = new Map(members.map((member) => [member.id, member.name]));
  const rows = events.map((event) => ({
    member: names.get(event.user_id) ?? "",
    title: event.title,
    start: event.start,
    end: event.end,
    timezone: "Asia/Shanghai",
  }));
  const content =
    format === "json"
      ? JSON.stringify(rows, null, 2)
      : "\ufeff" +
        [["成员", "事项", "开始", "结束", "时区"], ...rows.map((row) => Object.values(row))]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `laboratory-schedule.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export const LabCalendar = observer(function LabCalendar({
  store,
  team = false,
  scheduled,
  clearScheduled,
  onCalendarChanged,
}: {
  store: LabStore;
  team?: boolean;
  scheduled?: LabItem;
  clearScheduled: () => void;
  onCalendarChanged?: () => Promise<void>;
}) {
  const calendar = useRef<CalendarRef>(null);
  const days = weekDays(0);
  const [range, setRange] = useState({
    start: days[0]!.toISOString(),
    end: new Date(days[6]!.getTime() + 86400000).toISOString(),
  });
  const [title, setTitle] = useState("");
  const [view, setView] = useState(team ? "resourceTimelineWeek" : "timeGridWeek");
  const [userId, setUserId] = useState("all"),
    [projectId, setProjectId] = useState("all");
  const [allMembers, setAllMembers] = useState<LabMember[]>([]);
  const [editing, setEditing] = useState<LabEvent | "new">();
  const [initialStart, setInitialStart] = useState(roundedNow),
    [initialEnd, setInitialEnd] = useState(() => new Date(roundedNow().getTime() + 3600000));
  const [split, setSplit] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const editingEvent = editing && editing !== "new" ? editing : undefined;
  const planner = store.planner;
  const reload = useCallback(async () => {
    await store.loadCalendar(range.start, range.end, team, {
      userId: userId === "all" ? undefined : userId,
      projectId: projectId === "all" ? undefined : projectId,
    });
    if (userId === "all") setAllMembers(store.members);
  }, [store, range.start, range.end, team, userId, projectId]);
  useEffect(() => {
    void store.execute(reload);
  }, [reload, store, planner]);
  const openNew = useCallback(
    (start = roundedNow(), end = new Date(start.getTime() + 3600000)) => {
      setInitialStart(start);
      setInitialEnd(end);
      setEditing("new");
      setSplit(false);
      setConfirmDelete(false);
      store.error = "";
    },
    [store]
  );
  useEffect(() => {
    if (scheduled) openNew();
  }, [scheduled, openNew]);
  const close = () => {
    setEditing(undefined);
    setSplit(false);
    setConfirmDelete(false);
    clearScheduled();
  };
  const datesSet = useCallback((info: DatesSetInfo) => {
    const start = info.start.toISOString(),
      end = info.end.toISOString();
    setRange((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
    setTitle(info.view.title);
    setView(info.view.type);
  }, []);
  const select = useCallback(
    (info: DateSelectInfo) => {
      if (team && info.resource?.id !== store.planner?.user_id) {
        calendar.current?.getApi().unselect();
        return;
      }
      // Month selections describe whole days. Start at 09:00 for a useful first block.
      const start = info.allDay ? new Date(info.start.getTime() + 9 * 3600000) : info.start;
      openNew(start, info.allDay ? new Date(start.getTime() + 3600000) : info.end);
      calendar.current?.getApi().unselect();
    },
    [team, store, openNew]
  );
  const change = useCallback(
    (info: EventDropInfo | EventResizeDoneInfo) => {
      const block = store.events.find((event) => event.id === info.event.id);
      if (!block?.editable || !info.event.start || !info.event.end) {
        info.revert();
        return;
      }
      const start = info.event.start.toISOString(),
        end = info.event.end.toISOString();
      void store.execute(async () => {
        let saved: { overlap: boolean };
        try {
          saved = await store.request<{ overlap: boolean }>(`calendar/${block.id}/`, "PATCH", {
            expected_revision: block.revision,
            start,
            end,
          });
        } catch (failure) {
          info.revert();
          await reload();
          throw failure;
        }
        store.notice = saved.overlap ? "已保存；与已有排期重叠，请确认投入安排。" : "排期已保存";
        await reload();
        await onCalendarChanged?.();
      });
    },
    [store, reload, onCalendarChanged]
  );
  const events = useMemo<EventInput[]>(
    () =>
      store.events.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        resourceId: event.user_id,
        editable: event.editable && !store.busy,
        interactive: event.editable,
        resourceEditable: false,
        extendedProps: { block: event },
        className: event.kind ? "" : "lab-busy-event",
      })),
    [store.events, store.busy]
  );
  const resources = useMemo(
    () => store.members.map((member) => ({ id: member.id, title: member.name })),
    [store.members]
  );
  async function save(data: FormData) {
    await store.execute(async () => {
      const path = editingEvent ? `calendar/${editingEvent.id}/` : "calendar/";
      const body = split
        ? { expected_revision: editingEvent!.revision, split_at: calendarInstant(String(data.get("split_at"))) }
        : {
            ...(editingEvent ? { expected_revision: editingEvent.revision } : { item_id: data.get("item_id") }),
            start: calendarInstant(String(data.get("start"))),
            end: calendarInstant(String(data.get("end"))),
          };
      const result = await store
        .request<{ overlap?: boolean }>(path, editingEvent ? "PATCH" : "POST", body)
        .catch(async (failure: unknown) => {
          // Keep the form open, but refetch the authoritative version for reopening.
          await reload().catch(() => undefined);
          throw failure;
        });
      store.notice = result.overlap ? "已保存；与已有排期重叠，请确认投入安排。" : "排期已保存";
      close();
      await reload();
      await onCalendarChanged?.();
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays size={18} />
        <h2 className="mr-auto text-16 font-medium">{team ? "团队排期" : "个人周历"}</h2>
        <Button
          size="sm"
          variant="neutral-primary"
          aria-label="上一时段"
          onClick={() => calendar.current?.getApi().prev()}
        >
          <ChevronLeft size={15} />
        </Button>
        <Button size="sm" variant="neutral-primary" onClick={() => calendar.current?.getApi().today()}>
          今天
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          aria-label="下一时段"
          onClick={() => calendar.current?.getApi().next()}
        >
          <ChevronRight size={15} />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-13 font-medium">{title}</span>
        {(team ? teamViews : personalViews).map((option) => (
          <Button
            key={option.value}
            size="sm"
            aria-pressed={view === option.value}
            variant={view === option.value ? "primary" : "neutral-primary"}
            onClick={() => calendar.current?.getApi().changeView(option.value)}
          >
            {option.label}
          </Button>
        ))}
        {!team && (
          <Button size="sm" prependIcon={<Plus size={14} />} onClick={() => openNew()}>
            安排时间
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label="跳转日期"
          className="rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13"
          onChange={(event) => {
            if (event.target.value) calendar.current?.getApi().gotoDate(event.target.value);
          }}
        />
        {team && (
          <LabSelect
            label="筛选成员"
            value={userId}
            options={[
              { value: "all", label: "全部成员" },
              ...allMembers.map((member) => ({ value: member.id, label: member.name })),
            ]}
            onValueChange={setUserId}
          />
        )}
        <LabSelect
          label="筛选项目"
          value={projectId}
          options={[
            { value: "all", label: "全部项目及个人事项" },
            ...(store.planner?.projects ?? []).map((project) => ({ value: project.id, label: project.name })),
          ]}
          onValueChange={setProjectId}
        />
        <p className="mr-auto text-12 text-tertiary">
          上海时间 · 十五分钟步长{team ? " · 私人内容仅显示忙碌" : " · 排期与项目日期独立"}
        </p>
        <Button
          size="sm"
          variant="neutral-primary"
          prependIcon={<Download size={13} />}
          disabled={store.busy}
          onClick={() => exportEvents(store.events, store.members, "csv")}
        >
          CSV
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={store.busy}
          onClick={() => exportEvents(store.events, store.members, "json")}
        >
          JSON
        </Button>
      </div>
      <div className="lab-calendar min-w-0 overflow-hidden rounded-xl border border-subtle bg-surface-1">
        <FullCalendar
          ref={calendar}
          plugins={plugins}
          schedulerLicenseKey="AGPL-My-Frontend-And-Backend-Are-Open-Source"
          locale={zhCN}
          timeZone="Asia/Shanghai"
          firstDay={1}
          initialView={team ? "resourceTimelineWeek" : "timeGridWeek"}
          headerToolbar={false}
          height={650}
          events={events}
          resources={resources}
          resourceColumns={[{ field: "title", headerContent: "成员" }]}
          resourceColumnsWidth={150}
          editable={!store.busy}
          selectable={!store.busy}
          eventResourceEditable={false}
          selectMirror
          eventOverlap
          selectOverlap
          slotDuration={team && view === "resourceTimelineWeek" ? "01:00:00" : "00:15:00"}
          snapDuration="00:15:00"
          slotHeaderInterval="01:00:00"
          scrollTime="08:00:00"
          allDaySlot={false}
          nowIndicator
          datesSet={datesSet}
          select={select}
          eventDidMount={(info) => {
            info.el.dataset.labCalendarEvent = info.event.id;
          }}
          eventDrop={change}
          eventResize={change}
          eventClick={(info) => {
            const block = info.event.extendedProps.block as LabEvent;
            if (block?.editable) {
              store.error = "";
              setEditing(block);
              setSplit(false);
            }
          }}
          eventContent={(info) => {
            // FullCalendar's selection mirror is a temporary event without a
            // persisted block. Use its native dates until a member saves it.
            const block = info.event.extendedProps.block as LabEvent | undefined;
            const label = block?.title || info.event.title || "新时间块";
            const start = block?.start ?? info.event.start?.toISOString();
            const end = block?.end ?? info.event.end?.toISOString();
            return (
              <div className="h-full w-full overflow-hidden px-1 text-left" title={label}>
                <strong className="block truncate font-medium">{label}</strong>
                {start && end && (
                  <span className="text-11 opacity-80">
                    {clock(start)}–{clock(end)}
                  </span>
                )}
              </div>
            );
          }}
        />
      </div>
      {editing && !confirmDelete && (
        <LabDialog
          title={split ? "拆分时间块" : editingEvent ? "调整时间块" : "安排个人时间"}
          busy={store.busy}
          error={store.error}
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
                  defaultValue={localInput(editingEvent?.end ?? initialEnd)}
                />
              </LabField>
            </>
          )}
          {editingEvent && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="neutral-primary"
                disabled={new Date(editingEvent.end).getTime() - new Date(editingEvent.start).getTime() <= SLOT_MS}
                onClick={() => setSplit(!split)}
              >
                {split ? "调整起止" : "拆分时间块"}
              </Button>
              <Button size="sm" variant="neutral-primary" onClick={() => setConfirmDelete(true)}>
                删除时间块
              </Button>
            </div>
          )}
        </LabDialog>
      )}
      {confirmDelete && editingEvent && (
        <LabDialog
          title="删除时间块"
          busy={store.busy}
          error={store.error}
          destructive
          submitLabel="删除"
          onClose={() => setConfirmDelete(false)}
          onSubmit={() =>
            store.execute(async () => {
              await store
                .request(`calendar/${editingEvent.id}/`, "DELETE", {
                  expected_revision: editingEvent.revision,
                })
                .catch(async (failure: unknown) => {
                  await reload().catch(() => undefined);
                  throw failure;
                });
              close();
              await reload();
              await onCalendarChanged?.();
            })
          }
        >
          <p className="text-13 text-secondary">删除此段排期，事项和项目任务会保留。</p>
        </LabDialog>
      )}
    </div>
  );
});
