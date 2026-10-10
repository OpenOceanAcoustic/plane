/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { PageHeading } from "../../components/ui";
import { CanonicalIcon } from "../../components/navigation";
import type { LabEvent, LabItem, LabTask, LabMember } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { Button, LabDialog, LabDetail, LabField, Tabs, ErrorMessage, Empty, KeyValues, FloatingAction } from "./ui";
import { today, monthDays, scheduleMutation } from "./business";
import { calendarInstant, localInput } from "./calendar-time";
import { Fields } from "./fields";
import { Gantt } from "./gantt";
const statuses = [
  { id: "todo", name: "待做" },
  { id: "active", name: "进行中" },
  { id: "review", name: "待验收" },
  { id: "done", name: "完成" },
];
function calendarDateLabel(date: string) {
  const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 周${["日", "一", "二", "三", "四", "五", "六"][weekday]}`;
}
export function Planner({
  store,
  team = false,
  onOpenIssue,
  onOpenBounty,
}: {
  store: LabStore;
  team?: boolean;
  onOpenIssue?: (project: string, issue: string) => void;
  onOpenBounty: (id: string) => void;
}) {
  const [view, setView] = useState(team ? "week" : "overview");
  const [teamMode, setTeamMode] = useState("timeline");
  const [timelineScale, setTimelineScale] = useState("week");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyUnscheduled, setOnlyUnscheduled] = useState(false);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [day, setDay] = useState(today());
  const [folder, setFolder] = useState("all");
  const [project, setProject] = useState("");
  const [member, setMember] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<
    "item" | "detail" | "reference" | "folder" | "category" | "mapping" | "folder-list" | "category-list"
  >();
  const [chosenItemSnapshot, setChosenItem] = useState<LabItem>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [chosenFolder, setChosenFolder] = useState<{ id: string; name: string }>();
  const [chosenCategory, setChosenCategory] = useState<{ id: string; name: string; color: string }>();
  const [schedule, setSchedule] = useState<LabEvent | "new">();
  const [scheduledItem, setScheduledItem] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; title: string; revision?: number }>();
  const planner = store.planner;
  const chosenItem = planner?.items.find((item) => item.id === chosenItemSnapshot?.id) ?? chosenItemSnapshot;
  const last = monthDays(month).at(-1)!;
  const selectedStart = new Date(calendarInstant(`${day}T00:00`)).getTime();
  const weekStart = selectedStart - ((new Date(`${day}T12:00:00+08:00`).getUTCDay() + 6) % 7) * 86400000;
  const weekDates = Array.from({ length: 7 }, (_, index) =>
    localInput(new Date(weekStart + index * 86400000).toISOString()).slice(0, 10)
  );
  const rangeMode = view === "timeline" ? timelineScale : view;
  const monthStart = new Date(calendarInstant(`${month}-01T00:00`)).getTime();
  const monthEnd = new Date(calendarInstant(`${last}T00:00`)).getTime() + 86400000;
  const rangeStart = rangeMode === "week" ? weekStart : rangeMode === "agenda" ? selectedStart : monthStart;
  const rangeEnd =
    rangeMode === "week" ? weekStart + 7 * 86400000 : rangeMode === "agenda" ? selectedStart + 86400000 : monthEnd;
  const rangeDates = rangeMode === "week" ? weekDates : rangeMode === "agenda" ? [day] : monthDays(month);
  const dateChips = Array.from({ length: 5 }, (_, index) =>
    localInput(new Date(selectedStart + (index - 2) * 86400000).toISOString()).slice(0, 10)
  );
  const params = new URLSearchParams({
    start:
      rangeMode === "week" || view === "timeline"
        ? new Date(rangeStart).toISOString()
        : calendarInstant(`${month}-01T00:00`),
    end:
      rangeMode === "week" || view === "timeline"
        ? new Date(rangeEnd).toISOString()
        : new Date(new Date(calendarInstant(`${last}T00:00`)).getTime() + 86400000).toISOString(),
    team: team ? "1" : "0",
  });
  if (project) params.set("project_id", project);
  if (member) params.set("user_id", member);
  const calendar = useResource<{ events: LabEvent[]; members: LabMember[] }>(
    store,
    ["overview", "agenda", "month", "week", "timeline"].includes(view) ? `calendar/?${params}` : null
  );
  const search = useResource<LabTask[]>(
    store,
    dialog === "reference" ? `tasks/?q=${encodeURIComponent(query)}${project ? `&project_id=${project}` : ""}` : null
  );
  const rows = (planner?.items ?? []).filter(
    (item) =>
      (folder === "all" || (folder === "unclassified" ? !item.folder_id : item.folder_id === folder)) &&
      (!status || item.status === status) &&
      (!onlyUnscheduled || item.schedule.future_count === 0) &&
      (!project || item.project_id === project) &&
      `${item.title} ${item.description ?? ""} ${item.issue_key ?? ""}`.toLowerCase().includes(query.toLowerCase())
  );
  const events = (calendar.data?.events ?? []).filter(
    (row) =>
      team ||
      folder === "all" ||
      planner?.items.some(
        (item) => item.id === row.item_id && (folder === "unclassified" ? !item.folder_id : item.folder_id === folder)
      )
  );
  const timelineEvents = events.filter(
    (row) => new Date(row.start).getTime() < rangeEnd && new Date(row.end).getTime() > rangeStart
  );
  const run = (fn: () => Promise<void>) => store.execute(fn).catch(() => {});
  const reload = async () => {
    await store.loadPlanner();
    if (["overview", "agenda", "month", "week", "timeline"].includes(view)) await calendar.refresh();
  };
  const mutate = async (path: string, method: string, body?: unknown) => {
    await store.request(path, method, body);
    await reload();
  };
  const openItem = (item: LabItem) => {
    if (item.bounty_id && item.can_open_issue === false) onOpenBounty(item.bounty_id);
    else if (item.issue_id && item.project_id && item.can_open_issue !== false && onOpenIssue)
      onOpenIssue(item.project_id, item.issue_id);
    else {
      setChosenItem(item);
      setDetailOpen(true);
      setDialog("detail");
    }
  };
  const openEvent = (row: LabEvent) => {
    if (row.editable) setSchedule({ ...row });
    else if (row.issue_id && row.project_id && row.can_open_issue !== false && onOpenIssue)
      onOpenIssue(row.project_id, row.issue_id);
    else if (row.bounty_id) onOpenBounty(row.bounty_id);
  };
  const canOpenEvent = (row: LabEvent) =>
    row.editable ||
    !!(row.issue_id && row.project_id && row.can_open_issue !== false && onOpenIssue) ||
    !!row.bounty_id;
  function card(item: LabItem) {
    return (
      <article className="lab-card lab-planner-card" key={item.id}>
        <div className="lab-heading">
          <small className="lab-muted">{item.issue_key ?? "个人事项"}</small>
          <span className={`lab-badge ${item.status}`}>{statuses.find((row) => row.id === item.status)?.name}</span>
        </div>
        <button
          className="lab-card-row"
          onClick={() => {
            setChosenItem(item);
            setDetailOpen(true);
            setDialog("detail");
          }}
        >
          <h3>{item.title}</h3>
        </button>
        <div className="lab-card-meta">
          <span>{item.category_name ?? item.project_name ?? "个人事项"}</span>
          {item.target_date && <span>{item.target_date} 截止</span>}
          <span>{item.schedule.week_minutes ? `已安排 ${item.schedule.week_minutes / 60} h` : "未排期"}</span>
        </div>
      </article>
    );
  }
  function eventCard(row: LabEvent) {
    return (
      <div className="lab-agenda-row" key={row.id}>
        <div className="lab-agenda-time">
          <strong>{localInput(row.start).slice(11, 16)}</strong>
          <small>{localInput(row.end).slice(11, 16)}</small>
        </div>
        <button
          type="button"
          className="lab-agenda-card"
          style={{ borderColor: row.category_color || row.color || undefined }}
          disabled={!canOpenEvent(row)}
          onClick={() => openEvent(row)}
        >
          <h3>{row.title || "忙碌"}</h3>
          <p className="lab-muted">
            {team ? `${calendar.data?.members.find((person) => person.id === row.user_id)?.name ?? "成员"} · ` : ""}
            {row.category_name ?? "时间块"}
          </p>
        </button>
      </div>
    );
  }
  const visibleEvents = events.filter((row) =>
    view === "week"
      ? new Date(row.start).getTime() >= weekStart && new Date(row.start).getTime() < weekStart + 7 * 86400000
      : localInput(row.start).slice(0, 10) === day
  );
  const eventDates = Array.from(new Set(visibleEvents.map((row) => localInput(row.start).slice(0, 10))));
  const primaryView = ["board", "list"].includes(view) ? "board" : view === "overview" ? "overview" : "calendar";
  const title = team
    ? `团队排期${teamMode === "columns" ? " · 人员分列" : ""}`
    : view === "board"
      ? "文件夹看板"
      : view === "overview"
        ? "个人规划"
        : view === "fields"
          ? "事项表格"
          : view === "gantt"
            ? "甘特排期"
            : `个人日历${view === "week" ? " · 周" : view === "month" ? " · 月" : view === "timeline" ? " · 时间轴" : " · 日"}`;
  if (!planner)
    return (
      <>
        <PageHeading title={title} />
        <ErrorMessage error={store.error} />
        <Empty>正在加载规划…</Empty>
      </>
    );
  return (
    <>
      {!detailOpen && (
        <>
          <PageHeading title={title}>
            <button
              type="button"
              className="icon-button"
              aria-label="更多"
              title="更多"
              onClick={() => setToolsOpen(true)}
            >
              <CanonicalIcon name="menu" />
            </button>
          </PageHeading>
          <ErrorMessage error={store.error || calendar.error} />
          {notice && (
            <p role="status" className="lab-muted">
              {notice}
            </p>
          )}
          {team && !planner.team_access ? (
            <Empty>暂无团队排期查看权限。</Empty>
          ) : (
            <>
              {!team && view === "overview" && (
                <div className="lab-stats">
                  <div className="lab-stat">
                    <span>规划事项</span>
                    <strong>{planner.items.length}</strong>
                  </div>
                  <div className="lab-stat">
                    <span>待排事项</span>
                    <strong>
                      {
                        planner.items.filter((item) => item.schedule.future_count === 0 && item.status !== "done")
                          .length
                      }
                    </strong>
                  </div>
                  <div className="lab-stat">
                    <span>本周计划</span>
                    <strong>
                      {planner.items.reduce((total, item) => total + item.schedule.week_minutes, 0) / 60} h
                    </strong>
                  </div>
                </div>
              )}
              {!team && ["overview", "board", "list"].includes(view) && (
                <Tabs
                  value={primaryView}
                  onChange={(next) => setView(next === "calendar" ? "week" : next)}
                  items={[
                    { id: "overview", name: "综合" },
                    { id: "board", name: "文件夹看板" },
                    { id: "calendar", name: "个人周历" },
                  ]}
                />
              )}
              {!team && ["overview", "board", "list"].includes(view) && (
                <div className="lab-folders">
                  {[{ id: "all", name: "全部" }, ...planner.folders, { id: "unclassified", name: "未分类" }].map(
                    (row) => (
                      <button
                        key={row.id}
                        className={`lab-folder ${folder === row.id ? "active" : ""}`}
                        onClick={() => setFolder(row.id)}
                      >
                        <CanonicalIcon name="projects" />
                        <span className="folder-label">{row.name}</span>
                        <small className="folder-count">
                          {
                            planner.items.filter(
                              (item) =>
                                row.id === "all" ||
                                (row.id === "unclassified" ? !item.folder_id : item.folder_id === row.id)
                            ).length
                          }
                        </small>
                      </button>
                    )
                  )}
                </div>
              )}
              {view === "overview" && (
                <>
                  <div className="lab-section-heading">
                    <h3>{status ? statuses.find((row) => row.id === status)?.name : "进行中"}</h3>
                    <button className="lab-text-button" onClick={() => setFilterOpen(true)}>
                      筛选
                    </button>
                  </div>
                  {(status ? rows : rows.filter((item) => item.status === "active")).map(card)}
                  {!(status ? rows : rows.filter((item) => item.status === "active")).length && (
                    <Empty>暂无进行中事项。</Empty>
                  )}
                  <div className="lab-section-heading">
                    <h3>个人周历</h3>
                    <button className="lab-text-button" onClick={() => setView("week")}>
                      日 / 周 / 月
                    </button>
                  </div>
                </>
              )}
              {view === "board" && (
                <div className="lab-kanban">
                  {statuses
                    .filter((row) => !status || status === row.id)
                    .map((row) => (
                      <section className="lab-kanban-column" key={row.id}>
                        <h3>
                          {row.name} · {rows.filter((item) => item.status === row.id).length}
                        </h3>
                        {rows.filter((item) => item.status === row.id).map(card)}
                        <Button
                          onClick={() => {
                            setChosenItem(undefined);
                            setDialog("item");
                          }}
                        >
                          新增事项
                        </Button>
                      </section>
                    ))}
                </div>
              )}
              {view === "list" && (rows.length ? rows.map(card) : <Empty />)}
              {["gantt", "fields"].includes(view) && (
                <LabField label="项目">
                  <select value={project} onChange={(event) => setProject(event.target.value)}>
                    <option value="">{view === "gantt" ? "请选择项目" : "全部项目及个人事项"}</option>
                    {planner.projects.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </LabField>
              )}
              {["overview", "agenda", "month", "week", "timeline"].includes(view) && (
                <>
                  {view !== "overview" && (
                    <Tabs
                      value={team ? teamMode : view}
                      onChange={(next) => {
                        if (team) {
                          setTeamMode(next);
                          setView(next === "columns" ? "agenda" : "week");
                        } else setView(next);
                      }}
                      items={
                        team
                          ? [
                              { id: "timeline", name: "人员时间轴" },
                              { id: "columns", name: "人员分列" },
                            ]
                          : [
                              { id: "agenda", name: "日" },
                              { id: "week", name: "周" },
                              { id: "month", name: "月" },
                              { id: "timeline", name: "事项时间轴" },
                            ]
                      }
                    />
                  )}
                  {((team && teamMode === "timeline") || view === "timeline") && (
                    <div className="lab-calendar-chips" role="group" aria-label="时间范围">
                      {[
                        { id: "agenda", name: "日" },
                        { id: "week", name: "周" },
                        { id: "month", name: "月" },
                      ].map((entry) => (
                        <button
                          key={entry.id}
                          aria-pressed={rangeMode === entry.id}
                          className={rangeMode === entry.id ? "active" : ""}
                          onClick={() => (team ? setView(entry.id) : setTimelineScale(entry.id))}
                        >
                          {entry.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {((team && teamMode === "columns") || (!team && view === "agenda")) && (
                    <div className="lab-calendar-chips" role="group" aria-label="选择日期">
                      {(team ? weekDates : dateChips).map((date) => (
                        <button
                          key={date}
                          aria-pressed={day === date}
                          className={day === date ? "active" : ""}
                          onClick={() => {
                            setDay(date);
                            setMonth(date.slice(0, 7));
                          }}
                        >
                          {Number(date.slice(-2))} 周
                          {["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00+08:00`).getUTCDay()]}
                        </button>
                      ))}
                    </div>
                  )}
                  {team && (
                    <LabField label="成员">
                      <select value={member} onChange={(event) => setMember(event.target.value)}>
                        <option value="">全部成员</option>
                        {calendar.data?.members.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </LabField>
                  )}
                  {view !== "overview" && (
                    <LabField label="项目">
                      <select value={project} onChange={(event) => setProject(event.target.value)}>
                        <option value="">全部项目及个人事项</option>
                        {planner.projects.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </LabField>
                  )}
                  {view === "month" ? (
                    <>
                      <LabField label="排期月份">
                        <input
                          type="month"
                          value={month}
                          onChange={(event) => {
                            if (!event.target.value) return;
                            setMonth(event.target.value);
                            setDay(`${event.target.value}-01`);
                          }}
                        />
                      </LabField>
                      {!team && (
                        <div className="lab-month">
                          {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
                            <span key={label}>{label}</span>
                          ))}
                          {Array.from(
                            { length: (new Date(`${month}-01T12:00:00+08:00`).getUTCDay() + 6) % 7 },
                            (_, index) => (
                              <span key={`blank-${index}`} />
                            )
                          )}
                          {monthDays(month).map((date) => (
                            <button
                              key={date}
                              aria-label={date}
                              className={day === date ? "active" : ""}
                              onClick={() => setDay(date)}
                            >
                              {Number(date.slice(-2))}
                              <small>
                                {events.filter((row) => localInput(row.start).slice(0, 10) === date).length || ""}
                              </small>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    view !== "overview" && (
                      <LabField label={view === "week" ? "所选周的日期" : "日期"}>
                        <input
                          type="date"
                          value={day}
                          onChange={(event) => {
                            if (!event.target.value) return;
                            setDay(event.target.value);
                            setMonth(event.target.value.slice(0, 7));
                          }}
                        />
                      </LabField>
                    )
                  )}
                  {view === "week" && !team && (
                    <div className="lab-week">
                      <div className="lab-week-labels">
                        <span />
                        {weekDates.map((date, index) => (
                          <span key={date}>
                            {Number(date.slice(-2))} {["一", "二", "三", "四", "五", "六", "日"][index]}
                          </span>
                        ))}
                      </div>
                      <div className="lab-week-grid">
                        <div className="lab-week-hours">
                          {Array.from({ length: 13 }, (_, index) => (
                            <span key={index}>{index + 8}:00</span>
                          ))}
                        </div>
                        {weekDates.map((date) => (
                          <div className="lab-week-day" key={date}>
                            {visibleEvents
                              .filter((row) => localInput(row.start).slice(0, 10) === date)
                              .map((row) => {
                                const start = localInput(row.start);
                                const end = localInput(row.end);
                                const from = Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16));
                                const until =
                                  end.slice(0, 10) !== date
                                    ? 1440
                                    : Number(end.slice(11, 13)) * 60 + Number(end.slice(14, 16));
                                if (from >= 1200 || until <= 480) return null;
                                return (
                                  <button
                                    key={row.id}
                                    className="lab-week-event"
                                    disabled={!canOpenEvent(row)}
                                    style={{
                                      top: `${Math.max(0, from - 480) * 0.7}px`,
                                      height: `${Math.max(24, (Math.min(until, 1200) - Math.max(from, 480)) * 0.7)}px`,
                                      borderColor: row.category_color || row.color || undefined,
                                    }}
                                    onClick={() => openEvent(row)}
                                  >
                                    {row.title || "忙碌"}
                                  </button>
                                );
                              })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {view === "timeline" || (team && teamMode === "timeline") ? (
                    <>
                      <h3 className="lab-section-heading">
                        {rangeDates[0]} — {rangeDates.at(-1)}
                      </h3>
                      <div className="lab-range-timeline">
                        <div className="lab-range-labels">
                          <span>{team ? "成员" : "事项"}</span>
                          <div style={{ gridTemplateColumns: `repeat(${rangeDates.length}, minmax(28px, 1fr))` }}>
                            {rangeDates.map((date) => (
                              <span key={date}>{Number(date.slice(-2))}</span>
                            ))}
                          </div>
                        </div>
                        {timelineEvents.map((row) => (
                          <div className="lab-range-row" key={row.id}>
                            <span>
                              {team
                                ? (calendar.data?.members.find((person) => person.id === row.user_id)?.name ?? "成员")
                                : row.title || "忙碌"}
                            </span>
                            <div className="lab-range-track">
                              <button
                                className="lab-range-event"
                                disabled={!canOpenEvent(row)}
                                style={{
                                  left: `${Math.max(0, ((new Date(row.start).getTime() - rangeStart) / (rangeEnd - rangeStart)) * 100)}%`,
                                  width: `${Math.max(1, ((Math.min(new Date(row.end).getTime(), rangeEnd) - Math.max(new Date(row.start).getTime(), rangeStart)) / (rangeEnd - rangeStart)) * 100)}%`,
                                  borderColor: row.category_color || row.color || undefined,
                                }}
                                onClick={() => openEvent(row)}
                                title={`${row.title || "忙碌"} · ${localInput(row.start)} — ${localInput(row.end)}`}
                              >
                                {row.title || "忙碌"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {!team && <Button onClick={() => setFilterOpen(true)}>选择显示的文件夹与事项</Button>}
                      <h3 className="lab-section-heading">{team ? "排期明细" : "已选时间块"}</h3>
                      <div className="lab-agenda">{timelineEvents.map(eventCard)}</div>
                    </>
                  ) : team && teamMode === "columns" ? (
                    <div className="lab-team-records">
                      {Array.from(new Set(visibleEvents.map((row) => localInput(row.start).slice(11, 16))))
                        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022; sorts a newly created list
                        .sort()
                        .map((time) => {
                          const instant = new Date(calendarInstant(`${day}T${time}`)).getTime();
                          const active = visibleEvents.filter(
                            (row) => new Date(row.start).getTime() <= instant && new Date(row.end).getTime() > instant
                          );
                          return (
                            <article className="lab-card" key={time}>
                              <h3>{time}</h3>
                              <dl className="lab-kv">
                                {(calendar.data?.members ?? [])
                                  .filter((person) => !member || person.id === member)
                                  .map((person) => (
                                    <div key={person.id}>
                                      <dt>{person.name}</dt>
                                      <dd>
                                        {active.some((row) => row.user_id === person.id)
                                          ? active
                                              .filter((row) => row.user_id === person.id)
                                              .map((row) => (
                                                <button
                                                  key={row.id}
                                                  className="lab-text-button"
                                                  disabled={!canOpenEvent(row)}
                                                  onClick={() => openEvent(row)}
                                                >
                                                  {row.title || "忙碌"}
                                                </button>
                                              ))
                                          : "暂无排期"}
                                      </dd>
                                    </div>
                                  ))}
                              </dl>
                            </article>
                          );
                        })}
                      <h3 className="lab-section-heading">排期明细</h3>
                      <div className="lab-agenda">{visibleEvents.map(eventCard)}</div>
                    </div>
                  ) : (
                    <div className="lab-agenda">
                      {eventDates.map((date) => (
                        <section key={date}>
                          <h3 className="lab-section-heading">
                            <CanonicalIcon name="plan" size={18} />
                            <span>{calendarDateLabel(date)}</span>
                          </h3>
                          {visibleEvents
                            .filter((row) => localInput(row.start).slice(0, 10) === date)
                            // oxlint-disable-next-line unicorn/no-array-sort -- ES2022; sorts a newly filtered array
                            .sort((a, b) => a.start.localeCompare(b.start))
                            .map(eventCard)}
                        </section>
                      ))}
                    </div>
                  )}
                  {!calendar.loading &&
                    !(view === "timeline" || (team && teamMode === "timeline") ? timelineEvents : visibleEvents)
                      .length && <Empty>当前日期范围暂无排期。</Empty>}
                </>
              )}
              {view === "gantt" &&
                (project ? (
                  <Gantt store={store} projectId={project} onOpenIssue={onOpenIssue} />
                ) : (
                  <Empty>选择一个项目查看甘特排期。</Empty>
                ))}
              {view === "fields" && <Fields store={store} projectId={project} onOpenIssue={onOpenIssue} />}
              {!team && ["overview", "board", "list"].includes(view) && (
                <FloatingAction
                  label="新增事项"
                  onClick={() => {
                    setChosenItem(undefined);
                    setDialog("item");
                  }}
                />
              )}
              {["agenda", "month", "week", "timeline"].includes(view) && (
                <div className="lab-actions">
                  <Button
                    variant="primary"
                    onClick={() => {
                      setScheduledItem(rows[0]?.id ?? "");
                      setSchedule("new");
                    }}
                  >
                    安排时间
                  </Button>
                  <Button
                    onClick={() => {
                      setDay(today());
                      setMonth(today().slice(0, 7));
                    }}
                  >
                    今天
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {filterOpen && (
        <LabDialog
          title={team ? "筛选团队排期" : "筛选规划事项"}
          onClose={() => setFilterOpen(false)}
          onSubmit={async () => setFilterOpen(false)}
          submitLabel="应用筛选"
        >
          {(["agenda", "week", "month", "timeline"].includes(view) || team) && (
            <LabField label="跳转日期">
              <input
                type="date"
                value={day}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setDay(event.target.value);
                  setMonth(event.target.value.slice(0, 7));
                }}
              />
            </LabField>
          )}
          <LabField label="搜索">
            <input
              className="lab-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索事项或任务编号"
            />
          </LabField>
          <LabField label="项目">
            <select value={project} onChange={(event) => setProject(event.target.value)}>
              <option value="">全部项目与个人事项</option>
              {planner.projects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          {team ? (
            <LabField label="成员">
              <select value={member} onChange={(event) => setMember(event.target.value)}>
                <option value="">全部成员</option>
                {calendar.data?.members.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </LabField>
          ) : (
            <>
              <LabField label="显示的文件夹">
                <select value={folder} onChange={(event) => setFolder(event.target.value)}>
                  <option value="all">全部文件夹</option>
                  {planner.folders.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                  <option value="unclassified">未分类</option>
                </select>
              </LabField>
              <LabField label="状态">
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">全部状态</option>
                  {statuses.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </LabField>
              <label className="lab-switch-field">
                <span>仅看待排事项</span>
                <input
                  type="checkbox"
                  checked={onlyUnscheduled}
                  onChange={(event) => setOnlyUnscheduled(event.target.checked)}
                />
              </label>
            </>
          )}
          <Button
            onClick={() => {
              setQuery("");
              setProject("");
              setMember("");
              setStatus("");
              setFolder("all");
              setOnlyUnscheduled(false);
            }}
          >
            重置
          </Button>
        </LabDialog>
      )}
      {toolsOpen && (
        <LabDialog title="规划操作" onClose={() => setToolsOpen(false)}>
          <div className="lab-action-list">
            <button
              type="button"
              className="lab-action-row"
              onClick={() => {
                setToolsOpen(false);
                void run(reload);
              }}
            >
              刷新<span aria-hidden>›</span>
            </button>
            <button
              className="lab-action-row"
              onClick={() => {
                setToolsOpen(false);
                setFilterOpen(true);
              }}
            >
              筛选<span aria-hidden>›</span>
            </button>
            {!team &&
              [
                { id: "reference", name: "引用项目任务" },
                { id: "folder-list", name: "管理文件夹" },
                { id: "category-list", name: "事项类别" },
                { id: "mapping", name: "状态映射" },
              ].map((entry) => (
                <button
                  key={entry.id}
                  className="lab-action-row"
                  onClick={() => {
                    setToolsOpen(false);
                    if (entry.id === "reference") setQuery("");
                    setDialog(entry.id as typeof dialog);
                  }}
                >
                  {entry.name}
                  <span aria-hidden>›</span>
                </button>
              ))}
            {[
              ...(!team
                ? [
                    { id: "overview", name: "个人规划 · 综合" },
                    { id: "board", name: "文件夹看板" },
                    { id: "week", name: "个人周历" },
                  ]
                : []),
              ...(!team ? [{ id: "list", name: "事项列表" }] : []),
              { id: "gantt", name: "甘特排期" },
              ...(!team ? [{ id: "fields", name: "事项表格与字段" }] : []),
            ].map((entry) => (
              <button
                key={entry.id}
                className="lab-action-row"
                onClick={() => {
                  setToolsOpen(false);
                  setView(entry.id);
                }}
              >
                {entry.name}
                <span aria-hidden>›</span>
              </button>
            ))}
            <button
              className="lab-action-row"
              onClick={() => {
                setToolsOpen(false);
                setScheduledItem(rows[0]?.id ?? "");
                setSchedule("new");
              }}
            >
              新建时间块<span aria-hidden>›</span>
            </button>
          </div>
        </LabDialog>
      )}
      {detailOpen && chosenItem && (
        <LabDetail
          title="事项详情"
          onClose={() => {
            setDetailOpen(false);
            setChosenItem(undefined);
            setDialog(undefined);
          }}
        >
          <ErrorMessage error={store.error || calendar.error} />
          {notice && (
            <p role="status" className="lab-muted">
              {notice}
            </p>
          )}
          <article className="lab-card">
            <h3>{chosenItem.title}</h3>
            <p className="lab-muted">
              {chosenItem.issue_key ?? "个人事项"} · {chosenItem.category_name ?? "未分类"}
            </p>
          </article>
          {chosenItem.description && (
            <section>
              <h3 className="lab-section-heading">事项内容</h3>
              <p className="lab-item-description">{chosenItem.description}</p>
            </section>
          )}
          <KeyValues
            values={{
              状态: statuses.find((row) => row.id === chosenItem.status)?.name,
              事项类别: chosenItem.category_name ?? "未分类",
              文件夹: planner.folders.find((row) => row.id === chosenItem.folder_id)?.name ?? "未分类",
              可见范围: chosenItem.public ? "团队可见" : "仅自己可见",
              截止日期: chosenItem.target_date,
              本周计划: `${chosenItem.schedule.week_minutes / 60} h`,
            }}
          />
          <h3 className="lab-section-heading">当前排期</h3>
          {events.filter((row) => row.item_id === chosenItem.id).map(eventCard)}
          {!events.some((row) => row.item_id === chosenItem.id) && (
            <Empty>
              {chosenItem.schedule.next_start
                ? `最近排期 ${new Date(chosenItem.schedule.next_start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                : "尚未安排"}
            </Empty>
          )}
          <div className="lab-actions">
            <Button
              variant="primary"
              onClick={() => {
                setScheduledItem(chosenItem.id);
                setSchedule("new");
              }}
            >
              安排时间
            </Button>
            <Button onClick={() => setDialog("item")}>编辑事项</Button>
            {chosenItem.issue_id && chosenItem.project_id && chosenItem.can_open_issue !== false && onOpenIssue && (
              <Button
                onClick={() => {
                  setDetailOpen(false);
                  setDialog(undefined);
                  openItem(chosenItem);
                }}
              >
                打开项目任务
              </Button>
            )}
            {chosenItem.bounty_id && (
              <Button
                onClick={() => {
                  setDetailOpen(false);
                  setDialog(undefined);
                  onOpenBounty(chosenItem.bounty_id!);
                }}
              >
                悬赏流程
              </Button>
            )}
          </div>
        </LabDetail>
      )}
      {dialog === "item" && (
        <LabDialog
          title={chosenItem ? "整理事项" : "新建事项"}
          onClose={() => setDialog(detailOpen ? "detail" : undefined)}
          onSubmit={async (form) => {
            const item = chosenItem;
            const body = {
              title: form.get("title"),
              description: form.get("description"),
              category_id: form.get("category_id") || null,
              folder_id: form.get("folder_id") || null,
              public: form.get("public") === "on",
              ...(!(item?.bounty_id || item?.is_bounty) && item?.can_edit_issue !== false
                ? { status: form.get("status") }
                : {}),
            };
            await mutate(item ? `items/${item.id}/` : "items/", item ? "PATCH" : "POST", body);
            setDialog(detailOpen ? "detail" : undefined);
          }}
        >
          <LabField label="标题">
            <input
              name="title"
              required
              maxLength={255}
              defaultValue={chosenItem?.title}
              disabled={!!chosenItem?.issue_id}
            />
          </LabField>
          {!chosenItem?.issue_id && (
            <LabField label="说明">
              <textarea name="description" defaultValue={chosenItem?.description} />
            </LabField>
          )}
          <LabField label="文件夹">
            <select name="folder_id" defaultValue={chosenItem?.folder_id ?? ""}>
              <option value="">未分类</option>
              {planner.folders.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="分类">
            <select name="category_id" defaultValue={chosenItem?.category_id ?? planner.default_category_id ?? ""}>
              <option value="">未分类</option>
              {planner.categories?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          {!chosenItem?.bounty_id && !chosenItem?.is_bounty && chosenItem?.can_edit_issue !== false && (
            <LabField label="状态">
              <select name="status" defaultValue={chosenItem?.status ?? "todo"}>
                {statuses.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </LabField>
          )}
          {!chosenItem?.issue_id && (
            <label>
              <input name="public" type="checkbox" defaultChecked={chosenItem?.public} />
              团队可查看事项内容
            </label>
          )}
          {chosenItem && (
            <Button onClick={() => setDeleteTarget({ path: `items/${chosenItem.id}/`, title: chosenItem.title })}>
              移除个人规划引用
            </Button>
          )}
          {chosenItem?.bounty_id && (
            <Button
              onClick={() => {
                setDetailOpen(false);
                setDialog(undefined);
                onOpenBounty(chosenItem.bounty_id!);
              }}
            >
              处理悬赏状态
            </Button>
          )}
        </LabDialog>
      )}
      {dialog === "reference" && (
        <LabDialog
          title="引用项目任务"
          onClose={() => setDialog(undefined)}
          onSubmit={async (form) => {
            await mutate("items/", "POST", {
              issue_id: form.get("issue_id"),
              folder_id: folder === "all" || folder === "unclassified" ? null : folder,
              category_id: planner.default_project_category_id || null,
            });
            setDialog(undefined);
          }}
        >
          <LabField label="搜索任务">
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </LabField>
          <ErrorMessage error={search.error} />
          <LabField label="任务">
            <select name="issue_id" required>
              <option value="">请选择</option>
              {search.data?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.project} · {row.key} {row.title}
                </option>
              ))}
            </select>
          </LabField>
        </LabDialog>
      )}
      {(dialog === "folder-list" || dialog === "category-list") && (
        <LabDialog title={dialog === "folder-list" ? "文件夹管理" : "分类管理"} onClose={() => setDialog(undefined)}>
          <Button
            onClick={() => {
              if (dialog === "folder-list") {
                setChosenFolder(undefined);
                setDialog("folder");
              } else {
                setChosenCategory(undefined);
                setDialog("category");
              }
            }}
          >
            新增
          </Button>
          {(dialog === "folder-list" ? planner.folders : (planner.categories ?? [])).map((row, index, array) => (
            <div className="lab-card" key={row.id}>
              <h3>{row.name}</h3>
              <div className="lab-actions">
                <Button
                  onClick={() => {
                    if (dialog === "folder-list") {
                      setChosenFolder(row);
                      setDialog("folder");
                    } else {
                      setChosenCategory({
                        id: row.id,
                        name: row.name,
                        color: "color" in row ? String(row.color) : "#0f766e",
                      });
                      setDialog("category");
                    }
                  }}
                >
                  编辑
                </Button>
                {dialog === "folder-list" && (
                  <Button
                    disabled={index === 0}
                    onClick={() =>
                      void run(async () => {
                        const ids = array.map((r) => r.id);
                        [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                        await mutate(dialog === "folder-list" ? "folders/" : "categories/", "PUT", { ids });
                      })
                    }
                  >
                    上移
                  </Button>
                )}
                <Button
                  onClick={() =>
                    setDeleteTarget({
                      path: `${dialog === "folder-list" ? "folders" : "categories"}/${row.id}/`,
                      title: row.name,
                    })
                  }
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </LabDialog>
      )}
      {(dialog === "folder" || dialog === "category") && (
        <LabDialog
          title={dialog === "folder" ? "编辑文件夹" : "编辑分类"}
          onClose={() => setDialog(undefined)}
          onSubmit={async (form) => {
            const chosen = dialog === "folder" ? chosenFolder : chosenCategory;
            const base = dialog === "folder" ? "folders" : "categories";
            await mutate(`${base}/${chosen ? `${chosen.id}/` : ""}`, chosen ? "PATCH" : "POST", {
              name: form.get("name"),
              ...(base === "categories" ? { color: form.get("color") } : {}),
            });
            setDialog(undefined);
          }}
        >
          <LabField label="名称">
            <input
              name="name"
              maxLength={40}
              required
              defaultValue={(dialog === "folder" ? chosenFolder : chosenCategory)?.name}
            />
          </LabField>
          {dialog === "category" && (
            <LabField label="颜色">
              <input name="color" type="color" defaultValue={chosenCategory?.color ?? "#0f766e"} />
            </LabField>
          )}
        </LabDialog>
      )}
      {dialog === "mapping" && (
        <LabDialog
          title="个人状态与项目状态映射"
          onClose={() => setDialog(undefined)}
          onSubmit={async (form) => {
            const id = String(form.get("project_id"));
            await mutate(`flows/${id}/`, "PUT", Object.fromEntries(statuses.map((row) => [row.id, form.get(row.id)])));
            setDialog(undefined);
          }}
        >
          <LabField label="项目">
            <select name="project_id" value={project} required onChange={(e) => setProject(e.target.value)}>
              <option value="">请选择</option>
              {planner.projects
                .filter((row) => row.lead)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </LabField>
          {statuses.map((row) => (
            <LabField key={row.id} label={row.name}>
              <select
                key={`${project}-${row.id}`}
                name={row.id}
                defaultValue={planner.projects.find((p) => p.id === project)?.mapping[row.id as "todo"] ?? ""}
              >
                <option value="">不映射</option>
                {planner.projects
                  .find((p) => p.id === project)
                  ?.states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
              </select>
            </LabField>
          ))}
        </LabDialog>
      )}
      {schedule && (
        <LabDialog
          title={schedule === "new" ? "安排时间" : "调整排期"}
          onClose={() => setSchedule(undefined)}
          onSubmit={async (form) => {
            const event = schedule === "new" ? undefined : schedule;
            try {
              const result = await store.request<{ overlap?: boolean }>(
                event ? `calendar/${event.id}/` : "calendar/",
                event ? "PATCH" : "POST",
                {
                  ...scheduleMutation(event, String(form.get("start")), String(form.get("end"))),
                  ...(event ? {} : { item_id: form.get("item_id") }),
                  color: String(form.get("color") ?? ""),
                }
              );
              setNotice(result.overlap ? "已保存；排期有重叠，请确认投入安排。" : "排期已保存");
              await reload();
              setSchedule(undefined);
            } catch (e) {
              await reload().catch(() => {});
              throw e;
            }
          }}
        >
          {schedule === "new" && (
            <LabField label="事项">
              <select name="item_id" required defaultValue={scheduledItem}>
                <option value="">请选择</option>
                {planner.items.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </LabField>
          )}
          <LabField label="开始时间（上海）">
            <input
              type="datetime-local"
              name="start"
              step={900}
              required
              defaultValue={schedule === "new" ? `${day}T09:00` : localInput(schedule.start)}
            />
          </LabField>
          <LabField label="结束时间（上海）">
            <input
              type="datetime-local"
              name="end"
              step={900}
              required
              defaultValue={schedule === "new" ? `${day}T10:00` : localInput(schedule.end)}
            />
          </LabField>
          <LabField label="自定义颜色">
            <input
              name="color"
              type="color"
              defaultValue={schedule === "new" ? "#0f766e" : schedule.color || "#0f766e"}
            />
          </LabField>
          {schedule !== "new" && (
            <>
              <div className="lab-actions">
                {schedule.issue_id && schedule.project_id && schedule.can_open_issue !== false && onOpenIssue && (
                  <Button onClick={() => onOpenIssue(schedule.project_id!, schedule.issue_id!)}>查看任务</Button>
                )}
                {schedule.bounty_id && <Button onClick={() => onOpenBounty(schedule.bounty_id!)}>悬赏详情</Button>}
              </div>
              <LabField label="拆分时间（上海）">
                <input name="split_at" type="datetime-local" step={900} />
              </LabField>
              <Button
                onClick={async (e) => {
                  const form = e.currentTarget.closest("form");
                  const split = String(new FormData(form!).get("split_at") ?? "");
                  if (!split) {
                    setNotice("请先填写拆分时间");
                    return;
                  }
                  await run(async () => {
                    await mutate(`calendar/${schedule.id}/`, "PATCH", {
                      expected_revision: schedule.revision,
                      split_at: calendarInstant(split),
                    });
                    setSchedule(undefined);
                  });
                }}
              >
                拆分时间块
              </Button>
              <Button
                onClick={() =>
                  setDeleteTarget({
                    path: `calendar/${schedule.id}/`,
                    title: schedule.title,
                    revision: schedule.revision,
                  })
                }
              >
                删除时间块
              </Button>
            </>
          )}
        </LabDialog>
      )}
      {deleteTarget && (
        <LabDialog
          title={`删除 ${deleteTarget.title}`}
          destructive
          onClose={() => setDeleteTarget(undefined)}
          onSubmit={async () => {
            await mutate(
              deleteTarget.path,
              "DELETE",
              deleteTarget.revision === undefined ? undefined : { expected_revision: deleteTarget.revision }
            );
            setDeleteTarget(undefined);
            setSchedule(undefined);
            const removedItem = deleteTarget.path.startsWith("items/");
            if (removedItem) {
              setDetailOpen(false);
              setChosenItem(undefined);
            }
            setDialog(detailOpen && !removedItem ? "detail" : undefined);
          }}
        >
          <p>确认删除此记录？项目任务本体不会因移除规划引用而删除。</p>
        </LabDialog>
      )}
    </>
  );
}
