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
import type { ResourceInput } from "@fullcalendar/react-scheduler";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Download, Folder, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { Button, LabBountyBadge, LabColorPicker, LabDialog, LabField, LabSelect, labInputClass } from "@plane/ui";
import type { LabEvent, LabItem, LabMember } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { calendarInstant, localInput, SLOT_MS, weekDays } from "./calendar-time";
import { useCalendarViewportHeight } from "./calendar-size";
import { useCalendarTimelinePan } from "./calendar-pan";
import { calendarFolderColors, useCalendarFolders } from "./calendar-folders";
import { calendarColor, calendarContrast, calendarLegend } from "./calendar-colors";
import { LabItemDetails, labCanOpenProjectIssue } from "./item-details";
import type { LabOpenProjectIssue } from "./item-details";
import { LabTaskOverview } from "./task-overview";
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
  { value: "resourceTimeline", label: "事项时间轴" },
];
const teamViews = [
  { value: "resourceTimeline", label: "人员时间轴" },
  { value: "resourceTimeGridWeek", label: "人员分列" },
];
const timelineViews = [
  { value: "resourceTimelineDay", label: "日" },
  { value: "resourceTimelineWeek", label: "周" },
  { value: "resourceTimelineMonth", label: "月" },
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
  openProjectIssue,
}: {
  store: LabStore;
  team?: boolean;
  scheduled?: LabItem;
  clearScheduled: () => void;
  onCalendarChanged?: () => Promise<void>;
  openProjectIssue?: LabOpenProjectIssue;
}) {
  const calendar = useRef<CalendarRef>(null);
  const days = weekDays(0);
  const [range, setRange] = useState({
    start: days[0]!.toISOString(),
    end: new Date(days[6]!.getTime() + 86400000).toISOString(),
  });
  const [title, setTitle] = useState("");
  const [view, setView] = useState(team ? "resourceTimelineWeek" : "timeGridWeek");
  const [timelineView, setTimelineView] = useState("resourceTimelineWeek");
  const [calendarView, setCalendarView] = useState("timeGridWeek");
  const [zoom, setZoom] = useState(0);
  const [browse, setBrowse] = useState(true);
  const [viewing, setViewing] = useState<{ item: LabItem; block?: LabEvent }>();
  const timeline = view.startsWith("resourceTimeline");
  const [userId, setUserId] = useState("all"),
    [projectId, setProjectId] = useState("all");
  const [allMembers, setAllMembers] = useState<LabMember[]>([]);
  const [editing, setEditing] = useState<LabEvent | "new">();
  const [initialStart, setInitialStart] = useState(roundedNow),
    [initialEnd, setInitialEnd] = useState(() => new Date(roundedNow().getTime() + 3600000));
  const [initialItemId, setInitialItemId] = useState("");
  const [choosingFolders, setChoosingFolders] = useState(false);
  const [split, setSplit] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const editingEvent = editing && editing !== "new" ? editing : undefined;
  const planner = store.planner;
  const { surfaceRef, height } = useCalendarViewportHeight(`${store.slug}:${team}:${view}`);
  const navigateTimeline = useCallback((direction: -1 | 1) => {
    const api = calendar.current?.getApi();
    if (direction > 0) api?.next();
    else api?.prev();
  }, []);
  useCalendarTimelinePan(surfaceRef, team && timeline ? `${view}:${zoom}` : undefined, browse, navigateTimeline);
  const folders = useMemo(() => {
    const sorted = [...(planner?.folders ?? [])];
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted; only this local copy is mutated
    return sorted.sort((a, b) => a.position - b.position);
  }, [planner]);
  const { folderColors, hiddenFolderIds, setHiddenFolderIds } = useCalendarFolders(
    `lab-calendar-folders:${store.slug}:${planner?.user_id ?? ""}`,
    folders
  );
  const folderGroups = useMemo(
    () => [...folders, { id: "unclassified", name: "未分类", position: folders.length }],
    [folders]
  );
  const itemFolders = useMemo(() => {
    const ids = new Set(folders.map((folder) => folder.id));
    return new Map(
      planner?.items.map((item) => [item.id, ids.has(item.folder_id ?? "") ? item.folder_id! : "unclassified"])
    );
  }, [folders, planner]);
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
    (start = roundedNow(), end = new Date(start.getTime() + 3600000), itemId = "") => {
      setInitialStart(start);
      setInitialEnd(end);
      setInitialItemId(itemId);
      setEditing("new");
      setSplit(false);
      setConfirmDelete(false);
      store.error = "";
    },
    [store]
  );
  useEffect(() => {
    if (scheduled) openNew(undefined, undefined, scheduled.id);
  }, [scheduled, openNew]);
  const close = () => {
    setEditing(undefined);
    setSplit(false);
    setConfirmDelete(false);
    clearScheduled();
  };
  const adjust = (block: LabEvent) => {
    if (store.busy) return;
    // Details may have opened before a previous save finished reloading.
    // Capture the current revision when editing starts; later changes still
    // fail the existing expected_revision check when this form is saved.
    const current = store.events.find((event) => event.id === block.id);
    if (!current?.editable) return;
    setViewing(undefined);
    store.error = "";
    setEditing(current);
    setSplit(false);
    setConfirmDelete(false);
  };
  const showItem = (item: LabItem, block?: LabEvent) => {
    if (labCanOpenProjectIssue(item) && openProjectIssue)
      openProjectIssue({ issue_id: item.issue_id, project_id: item.project_id, archived: item.archived });
    else setViewing({ item, block });
  };
  const datesSet = useCallback((info: DatesSetInfo) => {
    const start = info.start.toISOString(),
      end = info.end.toISOString();
    setRange((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
    setTitle(info.view.title);
    setView(info.view.type);
    if (info.view.type.startsWith("resourceTimeline")) setTimelineView(info.view.type);
    if (["timeGridDay", "timeGridWeek", "dayGridMonth"].includes(info.view.type)) setCalendarView(info.view.type);
  }, []);
  const select = useCallback(
    (info: DateSelectInfo) => {
      if (team && info.resource?.id !== store.planner?.user_id) {
        calendar.current?.getApi().unselect();
        return;
      }
      const itemId = !team && timeline ? (info.resource?.extendedProps.itemId as string | undefined) : undefined;
      if (!team && timeline && !itemId) {
        calendar.current?.getApi().unselect();
        return;
      }
      // Month selections describe whole days. Start at 09:00 for a useful first block.
      const start = info.allDay ? new Date(info.start.getTime() + 9 * 3600000) : info.start;
      openNew(start, info.allDay ? new Date(start.getTime() + 3600000) : info.end, itemId);
      calendar.current?.getApi().unselect();
    },
    [team, timeline, store, openNew]
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
  const visibleEvents = useMemo(
    () =>
      store.events.filter((event) => {
        const folderId = itemFolders.get(event.item_id ?? "");
        // Opaque blocks have no readable item or folder. Keep them in a neutral
        // busy row even when the member hides their unclassified folder.
        return team || !timeline || !folderId || !hiddenFolderIds.includes(folderId);
      }),
    [store.events, team, timeline, hiddenFolderIds, itemFolders]
  );
  const events = useMemo<EventInput[]>(
    () =>
      visibleEvents.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        resourceId: team ? event.user_id : itemFolders.has(event.item_id ?? "") ? `item:${event.item_id}` : "busy",
        editable: event.editable && !store.busy,
        interactive: Boolean(event.issue_id || planner?.items.some((item) => item.id === event.item_id)),
        resourceEditable: false,
        extendedProps: { block: event },
        className: event.kind ? (event.bounty_id || event.is_bounty ? "lab-bounty-event" : "") : "lab-busy-event",
        color: calendarColor(event),
        contrastColor: calendarContrast(calendarColor(event)),
      })),
    [visibleEvents, store.busy, team, itemFolders, planner]
  );
  const legend = calendarLegend(visibleEvents);
  const resources = useMemo<ResourceInput[]>(() => {
    if (team) return store.members.map((member) => ({ id: member.id, title: member.name }));
    if (!planner) return [];
    const groups: ResourceInput[] = folderGroups
      .filter((folder) => !hiddenFolderIds.includes(folder.id))
      .map((folder, order) => ({
        id: `folder:${folder.id}`,
        title: folder.name,
        order,
        extendedProps: { color: folderColors[folder.id] ?? "grey", folder: true },
        children: planner.items
          .filter((item) => itemFolders.get(item.id) === folder.id)
          .filter((item) => projectId === "all" || item.project_id === projectId)
          .map((item, itemOrder) => ({
            id: `item:${item.id}`,
            title: item.title,
            order: itemOrder,
            extendedProps: { itemId: item.id, issueKey: item.issue_key, color: folderColors[folder.id] ?? "grey" },
          })),
      }));
    if (visibleEvents.some((event) => !itemFolders.has(event.item_id ?? ""))) {
      groups.push({
        id: "busy",
        title: "忙碌",
        order: folderGroups.length,
        eventColor: "var(--label-grey-bg)",
        eventContrastColor: "var(--label-grey-text)",
        extendedProps: { color: "grey" },
      });
    }
    return groups;
  }, [
    team,
    store.members,
    planner,
    projectId,
    folderGroups,
    folderColors,
    hiddenFolderIds,
    itemFolders,
    visibleEvents,
  ]);
  async function save(data: FormData) {
    await store.execute(async () => {
      const path = editingEvent ? `calendar/${editingEvent.id}/` : "calendar/";
      const body = split
        ? { expected_revision: editingEvent!.revision, split_at: calendarInstant(String(data.get("split_at"))) }
        : {
            ...(editingEvent ? { expected_revision: editingEvent.revision } : { item_id: data.get("item_id") }),
            start: calendarInstant(String(data.get("start"))),
            end: calendarInstant(String(data.get("end"))),
            ...(!team && timeline ? {} : { color: String(data.get("color") ?? "") }),
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
        {(team
          ? teamViews
          : timeline
            ? [
                { value: calendarView, label: "日历" },
                { value: "resourceTimeline", label: "事项时间轴" },
              ]
            : personalViews
        ).map((option) => (
          <Button
            key={option.value}
            size="sm"
            aria-pressed={option.value === "resourceTimeline" ? timeline : view === option.value}
            variant={
              (option.value === "resourceTimeline" ? timeline : view === option.value) ? "primary" : "neutral-primary"
            }
            onClick={() =>
              calendar.current?.getApi().changeView(option.value === "resourceTimeline" ? timelineView : option.value)
            }
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
      {timeline && (
        <nav aria-label="时间轴范围" className="flex flex-wrap items-center gap-2">
          <span className="text-12 text-secondary">范围</span>
          {timelineViews.map((option) => (
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
          {team && (
            <Button
              size="sm"
              variant={browse ? "neutral-primary" : "primary"}
              aria-pressed={!browse}
              onClick={() => setBrowse((value) => !value)}
            >
              框选排期
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="时间轴缩放">
            <Button
              size="sm"
              variant="neutral-primary"
              aria-label="缩小时间轴"
              disabled={zoom === 0}
              onClick={() => setZoom((value) => Math.max(0, value - 1))}
            >
              <ZoomOut size={15} />
            </Button>
            <Button
              size="sm"
              variant={zoom === 0 ? "primary" : "neutral-primary"}
              aria-pressed={zoom === 0}
              onClick={() => {
                setZoom(0);
                calendar.current?.getApi().scrollToTime("00:00:00");
              }}
            >
              总览
            </Button>
            <Button
              size="sm"
              variant="neutral-primary"
              aria-label="放大时间轴"
              disabled={zoom === 3}
              onClick={() => setZoom((value) => Math.min(3, value + 1))}
            >
              <ZoomIn size={15} />
            </Button>
          </div>
          {!team && (
            <Button
              size="sm"
              variant="neutral-primary"
              prependIcon={<Folder size={14} />}
              onClick={() => setChoosingFolders(true)}
            >
              显示文件夹
            </Button>
          )}
        </nav>
      )}
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
        <Button
          size="sm"
          variant="neutral-primary"
          className="ml-auto"
          prependIcon={<Download size={13} />}
          disabled={store.busy}
          onClick={() => exportEvents(visibleEvents, store.members, "csv")}
        >
          CSV
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={store.busy}
          onClick={() => exportEvents(visibleEvents, store.members, "json")}
        >
          JSON
        </Button>
      </div>
      <div
        ref={surfaceRef}
        className={`lab-calendar min-w-0 overflow-hidden rounded-xl border border-subtle bg-surface-1 ${team && timeline ? `lab-calendar-timeline ${browse ? "lab-calendar-browsing" : ""}` : ""}`}
      >
        <FullCalendar
          ref={calendar}
          plugins={plugins}
          schedulerLicenseKey="AGPL-My-Frontend-And-Backend-Are-Open-Source"
          locale={zhCN}
          timeZone="Asia/Shanghai"
          firstDay={1}
          initialView={team ? "resourceTimelineWeek" : "timeGridWeek"}
          headerToolbar={false}
          height={height}
          events={events}
          resources={resources}
          resourceColumns={[{ field: "title", headerContent: team ? "成员" : "文件夹 / 事项" }]}
          resourceColumnsWidth={team ? 150 : "35%"}
          resourceOrder={team ? "title" : "order,title"}
          resourcesInitiallyExpanded
          filterResourcesWithEvents={false}
          resourceCellContent={(info) => {
            const resource = info.resource;
            if (!resource) return null;
            const item = !team ? planner?.items.find((row) => row.id === resource.extendedProps.itemId) : undefined;
            return (
              <span className="flex min-w-0 items-center gap-2" title={resource.title}>
                {!team && (
                  <span
                    aria-hidden
                    className="lab-folder-marker"
                    style={{ backgroundColor: calendarFolderColors(String(resource.extendedProps.color)).marker }}
                  />
                )}
                {item ? (
                  <button
                    type="button"
                    className="min-w-0 truncate text-left hover:text-accent-primary"
                    aria-label={`查看事项 ${item.title}`}
                    onClick={() => showItem(item)}
                  >
                    {item.title}
                    {item.issue_key && <span className="ml-2 text-11 text-tertiary">{item.issue_key}</span>}
                  </button>
                ) : (
                  <span
                    className={`min-w-0 truncate ${resource.extendedProps.folder ? "rounded px-2 py-1 font-medium" : ""}`}
                    style={
                      resource.extendedProps.folder
                        ? {
                            backgroundColor: calendarFolderColors(String(resource.extendedProps.color)).background,
                            color: calendarFolderColors(String(resource.extendedProps.color)).foreground,
                          }
                        : undefined
                    }
                  >
                    {resource.title}
                    {!team && resource.extendedProps.issueKey && (
                      <span className="ml-2 text-11 text-tertiary">{String(resource.extendedProps.issueKey)}</span>
                    )}
                  </span>
                )}
              </span>
            );
          }}
          resourceLaneDidMount={(info) => {
            info.el.dataset.labResource = info.resource.id;
            if (!team && info.resource.extendedProps.itemId) {
              info.el.dataset.labItem = String(info.resource.extendedProps.itemId);
            }
          }}
          editable={!store.busy}
          selectable={!store.busy && !(team && timeline && browse)}
          eventResourceEditable={false}
          selectMirror
          selectAllow={(info) =>
            team ? info.resource?.id === planner?.user_id : !timeline || Boolean(info.resource?.extendedProps.itemId)
          }
          eventOverlap
          selectOverlap
          slotDuration={
            timeline
              ? view === "resourceTimelineMonth"
                ? "24:00:00"
                : view === "resourceTimelineWeek"
                  ? "06:00:00"
                  : zoom === 0
                    ? "02:00:00"
                    : "01:00:00"
              : "00:15:00"
          }
          snapDuration="00:15:00"
          slotHeaderInterval={
            timeline && view !== "resourceTimelineDay" ? "24:00:00" : timeline && zoom === 0 ? "06:00:00" : "01:00:00"
          }
          slotHeaderFormat={
            view === "resourceTimelineMonth"
              ? zoom === 0
                ? { day: "numeric" }
                : { day: "numeric", weekday: "short" }
              : undefined
          }
          slotMinWidth={timeline && zoom === 0 ? 1 : 60 * Math.max(1, 2 ** (zoom - 1))}
          slotHeaderClass={team && timeline ? "lab-calendar-pan-header" : undefined}
          eventMinWidth={24}
          scrollTime={timeline && zoom === 0 ? "00:00:00" : "08:00:00"}
          footerScrollbarSticky={timeline}
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
            if (!block?.item_id) return;
            const item = planner?.items.find((row) => row.id === block.item_id);
            if (item) showItem(item, block);
            else if (block.bounty_id && block.can_edit_issue === false)
              window.location.assign(`/${store.slug}/lab/bounties?bounty_id=${encodeURIComponent(block.bounty_id)}`);
            else if (block.issue_id && block.project_id && openProjectIssue)
              openProjectIssue({ issue_id: block.issue_id, project_id: block.project_id });
          }}
          eventContent={(info) => {
            // FullCalendar's selection mirror is a temporary event without a
            // persisted block. Use its native dates until a member saves it.
            const block = info.event.extendedProps.block as LabEvent | undefined;
            const label = block?.title || info.event.title || "新时间块";
            const start = block?.start ?? info.event.start?.toISOString();
            const end = block?.end ?? info.event.end?.toISOString();
            return (
              <div className="group/lab-event relative h-full w-full overflow-hidden px-1 text-left" title={label}>
                <strong className="flex items-center gap-1 truncate font-medium">
                  {block?.kind && (block.bounty_id || block.is_bounty) && (
                    <LabBountyBadge compact color={calendarContrast(calendarColor(block))} />
                  )}
                  {label}
                </strong>
                {start && end && (
                  <span className="text-11 opacity-80">
                    {clock(start)}–{clock(end)}
                  </span>
                )}
                {block?.editable && !info.isMirror && (
                  <button
                    type="button"
                    aria-label={`调整 ${label} 的排期`}
                    title="调整排期"
                    disabled={store.busy}
                    className="absolute top-0 right-0 rounded bg-surface-1 p-0.5 text-primary opacity-0 group-hover/lab-event:opacity-100 hover:bg-layer-1 focus-visible:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      adjust(block);
                    }}
                  >
                    <Clock3 size={13} />
                  </button>
                )}
              </div>
            );
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {legend.length > 0 && (
          <ul aria-label="排期类别颜色" className="flex flex-wrap items-center gap-3 text-12 text-secondary">
            {legend.map((entry) => (
              <li key={entry.id} className="flex max-w-full min-w-0 items-center gap-1" title={entry.name}>
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="min-w-0 break-words">{entry.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {viewing && viewing.item.bounty_id && !labCanOpenProjectIssue(viewing.item) ? (
        <LabTaskOverview
          key={viewing.item.id}
          store={store}
          item={viewing.item}
          onClose={() => setViewing(undefined)}
          onSchedule={() => {
            setViewing(undefined);
            openNew(undefined, undefined, viewing.item.id);
          }}
          onAdjust={viewing.block?.editable ? () => adjust(viewing.block!) : undefined}
        />
      ) : (
        viewing && (
          <LabItemDetails
            key={viewing.item.id}
            item={viewing.item}
            block={viewing.block}
            folderName={folders.find((folder) => folder.id === viewing.item.folder_id)?.name}
            onClose={() => setViewing(undefined)}
            onSchedule={() => {
              setViewing(undefined);
              openNew(undefined, undefined, viewing.item.id);
            }}
            onAdjust={viewing.block?.editable ? () => adjust(viewing.block!) : undefined}
            busy={store.busy}
          />
        )
      )}
      {choosingFolders && (
        <LabDialog
          title="选择显示的文件夹"
          busy={false}
          onClose={() => setChoosingFolders(false)}
          onSubmit={async (data) => {
            const shown = new Set(data.getAll("folder_id").map(String));
            setHiddenFolderIds(folderGroups.filter((folder) => !shown.has(folder.id)).map((folder) => folder.id));
            setChoosingFolders(false);
          }}
        >
          {folderGroups.map((folder) => (
            <label
              key={folder.id}
              className="flex items-center gap-3 rounded-md border border-subtle px-3 py-2 text-13"
            >
              <input
                type="checkbox"
                name="folder_id"
                value={folder.id}
                defaultChecked={!hiddenFolderIds.includes(folder.id)}
              />
              <span
                aria-hidden
                className="lab-folder-marker"
                style={{ backgroundColor: calendarFolderColors(folderColors[folder.id]).marker }}
              />
              {folder.name}
            </label>
          ))}
        </LabDialog>
      )}
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
              <select
                name="item_id"
                className={labInputClass}
                value={initialItemId}
                onChange={(event) => setInitialItemId(event.target.value)}
                required
              >
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
              <LabColorPicker
                label="排期颜色"
                automatic
                initialValue={editingEvent?.color ?? ""}
                defaultColor={
                  editingEvent?.category_color ??
                  planner?.items.find((item) => item.id === initialItemId)?.category_color ??
                  "#64748b"
                }
              />
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
