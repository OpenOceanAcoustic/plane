/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { observer } from "mobx-react";
import FullCalendar from "@fullcalendar/react";
import type { CalendarRef, EventInput } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import themePlugin from "@fullcalendar/react/themes/monarch";
import zhCN from "@fullcalendar/react/locales/zh-cn";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Coins } from "lucide-react";
import { LabContributionsStore } from "@plane/shared-state";
import type { LabStore } from "@plane/shared-state";
import type { LabContributionDay, LabContributionEntry } from "@plane/types";
import { Button, labInputClass } from "@plane/ui";
import { LabItemOverviewSurface } from "./item-details";
import type { LabOpenProjectIssue } from "./item-details";
import { LabTaskOverview } from "./task-overview";
// oxlint-disable-next-line import/no-unassigned-import -- bundled FullCalendar layout styles
import "@fullcalendar/react/skeleton.css";
// oxlint-disable-next-line import/no-unassigned-import -- local calendar theme
import "@fullcalendar/react/themes/monarch/theme.css";
// oxlint-disable-next-line import/no-unassigned-import -- shared Plane calendar tokens
import "./calendar.css";
// oxlint-disable-next-line import/no-unassigned-import -- contribution page layout and project accents
import "./contributions.css";

const plugins = [themePlugin, dayGridPlugin];
const palette = ["indigo", "emerald", "purple", "orange", "pink", "yellow"] as const;
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function calendarDay(date: Date) {
  const parts = dayFormat.formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function moveMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, number! - 1 + offset, 1)).toISOString().slice(0, 7);
}

function projectStyle(id: string): CSSProperties {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const color = palette[hash % palette.length]!;
  return {
    "--lab-contribution-bg": `var(--label-${color}-bg)`,
    "--lab-contribution-text": `var(--label-${color}-text)`,
    "--lab-contribution-border": `var(--label-${color}-border)`,
  } as CSSProperties;
}

export const LabContributions = observer(function LabContributions({
  store,
  refreshKey = 0,
  openProjectIssue,
}: {
  store: LabStore;
  refreshKey?: number;
  openProjectIssue?: LabOpenProjectIssue;
}) {
  const contributions = useMemo(() => new LabContributionsStore(store), [store]);
  const calendar = useRef<CalendarRef>(null);
  const [chosen, setChosen] = useState<LabContributionEntry>();
  const [showBounty, setShowBounty] = useState(false);
  useEffect(() => {
    void contributions.refresh();
    const refresh = () => {
      if (document.visibilityState === "visible") void contributions.refresh();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [contributions, refreshKey]);
  useEffect(() => {
    calendar.current?.getApi().gotoDate(`${contributions.selectedMonth}-01`);
    setChosen(undefined);
    setShowBounty(false);
  }, [contributions, contributions.selectedMonth, contributions.selectedProjectId, contributions.selectedDay]);
  const summary = contributions.summary;
  const range = contributions.calendar;
  const entries = contributions.entries;
  const currentEntry = chosen ? entries?.results.find((entry) => entry.id === chosen.id) : undefined;
  const sourceReady = Boolean(
    currentEntry && !contributions.entriesBusy && !contributions.rangeBusy && !contributions.error
  );
  useEffect(() => {
    if (!sourceReady || !currentEntry?.can_open_bounty) setShowBounty(false);
  }, [sourceReady, currentEntry?.can_open_bounty]);
  const events = useMemo<EventInput[]>(
    () =>
      (range?.days ?? []).map((day) => ({
        id: `${day.day}:${day.project_id}`,
        title: day.project,
        start: day.day,
        allDay: true,
        extendedProps: { contribution: day },
        className: "lab-contribution-calendar-event",
      })),
    [range]
  );
  const selectDay = (day: string, projectId?: string) => void contributions.selectDay(day, projectId);
  return (
    <div className="lab-contributions">
      {contributions.error && (
        <p role="alert" className="lab-contributions-error">
          {contributions.error}
        </p>
      )}
      <section aria-label="个人 VC 总额" className="lab-contributions-totals">
        <div className="lab-contributions-net">
          <Coins size={19} aria-hidden="true" />
          <dl>
            <dt>个人净 VC</dt>
            <dd>{summary ? `${summary.totals.net} VC` : "—"}</dd>
          </dl>
        </div>
        <dl className="lab-contributions-total">
          <dt>累计获得</dt>
          <dd>{summary ? `${summary.totals.earned} VC` : "—"}</dd>
        </dl>
        <dl className="lab-contributions-total">
          <dt>累计冲正</dt>
          <dd>{summary ? `${summary.totals.reversed} VC` : "—"}</dd>
        </dl>
      </section>
      {contributions.summaryBusy && (
        <p role="status" className="text-13 text-secondary">
          正在读取个人 VC…
        </p>
      )}
      <section aria-label="参与项目" className="lab-contributions-projects-section">
        <h2 className="text-14 font-semibold">参与项目{summary ? ` · ${summary.projects.length}` : ""}</h2>
        <div className="lab-contributions-projects">
          {summary?.projects.map((project) => (
            <article key={project.id} className="lab-contributions-project" style={projectStyle(project.id)}>
              <button
                type="button"
                aria-label={`筛选项目 ${project.name}`}
                aria-pressed={contributions.selectedProjectId === project.id}
                className="lab-contributions-project-select"
                onClick={() =>
                  void contributions.selectProject(contributions.selectedProjectId === project.id ? "" : project.id)
                }
              >
                <span className="lab-contributions-project-name">{project.name}</span>
                <strong>{project.net} VC</strong>
                <span className="lab-contributions-project-changes">
                  获得 {project.earned} · 冲正 {project.reversed}
                </span>
              </button>
              <div className="lab-contributions-project-status">
                <span>
                  {project.historical
                    ? "历史参与"
                    : project.participation.includes("project")
                      ? "项目成员"
                      : "悬赏参与"}
                </span>
                {project.can_open_project && (
                  <a href={`/${store.slug}/projects/${project.id}/issues`} className="text-accent-primary">
                    打开项目
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
        {summary && summary.projects.length === 0 && <p className="text-13 text-tertiary">暂无参与项目</p>}
      </section>
      <div className="lab-contributions-filters">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="neutral-primary"
            aria-label="上一月"
            onClick={() => void contributions.selectMonth(moveMonth(contributions.selectedMonth, -1))}
          >
            <ChevronLeft size={15} />
          </Button>
          <input
            type="month"
            aria-label="选择月份"
            className={labInputClass}
            value={contributions.selectedMonth}
            onChange={(event) => {
              if (event.target.value) void contributions.selectMonth(event.target.value);
            }}
          />
          <Button
            size="sm"
            variant="neutral-primary"
            aria-label="下一月"
            onClick={() => void contributions.selectMonth(moveMonth(contributions.selectedMonth, 1))}
          >
            <ChevronRight size={15} />
          </Button>
          <Button
            size="sm"
            variant="neutral-primary"
            onClick={() => void contributions.selectMonth(calendarDay(new Date()).slice(0, 7))}
          >
            本月
          </Button>
        </div>
        <select
          aria-label="筛选项目"
          className={labInputClass}
          value={contributions.selectedProjectId}
          onChange={(event) => void contributions.selectProject(event.target.value)}
        >
          <option value="">全部项目</option>
          {summary?.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      <section aria-label="VC 日历" className="lab-contributions-calendar-section">
        <div className="lab-contributions-section-heading">
          <h2 className="text-14 font-semibold">VC 日历</h2>
          <dl className="lab-contributions-month-totals">
            <div>
              <dt>本月获得</dt>
              <dd>{range ? `${range.totals.earned} VC` : "—"}</dd>
            </div>
            <div>
              <dt>本月冲正</dt>
              <dd>{range ? `${range.totals.reversed} VC` : "—"}</dd>
            </div>
            <div>
              <dt>本月净变化</dt>
              <dd>{range ? `${range.totals.net} VC` : "—"}</dd>
            </div>
          </dl>
        </div>
        {contributions.rangeBusy && (
          <p role="status" className="text-13 text-secondary">
            正在读取月历…
          </p>
        )}
        <div className="lab-calendar lab-contributions-calendar">
          <FullCalendar
            ref={calendar}
            plugins={plugins}
            locale={zhCN}
            timeZone="Asia/Shanghai"
            firstDay={1}
            initialView="dayGridMonth"
            initialDate={`${contributions.selectedMonth}-01`}
            headerToolbar={false}
            height="auto"
            events={events}
            editable={false}
            selectable={false}
            fixedWeekCount={false}
            showNonCurrentDates={false}
            dayCellTopContent={(info) => {
              const day = calendarDay(info.date);
              return (
                <button
                  type="button"
                  ref={(button) => {
                    // FullCalendar hides its decorative date label. This
                    // replacement is an interactive control and must be exposed.
                    button?.parentElement?.removeAttribute("aria-hidden");
                  }}
                  aria-label={`查看 ${day} 的 VC 明细`}
                  aria-pressed={contributions.selectedDay === day}
                  className="lab-contributions-day"
                  onClick={() => selectDay(day)}
                >
                  {info.dayNumberText}
                </button>
              );
            }}
            eventContent={(info) => {
              const day = info.event.extendedProps.contribution as LabContributionDay;
              return (
                <button
                  type="button"
                  aria-label={`查看 ${day.day} · ${day.project}的 VC 明细`}
                  title={`${day.project} · 获得 ${day.earned} VC · 冲正 ${day.reversed} VC`}
                  className="lab-contributions-day-project"
                  style={projectStyle(day.project_id)}
                  onClick={() => selectDay(day.day, day.project_id)}
                >
                  <span className="lab-contributions-day-project-name">{day.project}</span>
                  <span className="lab-contributions-day-project-values">
                    {day.earned !== "0.00" && <span>+{day.earned}</span>}
                    {day.reversed !== "0.00" && <span>−{day.reversed} 冲正</span>}
                  </span>
                </button>
              );
            }}
          />
        </div>
      </section>
      <section aria-label="VC 明细" className="lab-contributions-entries-section">
        <div className="lab-contributions-section-heading">
          <h2 className="text-14 font-semibold">
            VC 明细{contributions.selectedDay ? ` · ${contributions.selectedDay}` : ""}
          </h2>
          {contributions.selectedDay && (
            <Button size="sm" variant="neutral-primary" onClick={() => selectDay("")}>
              清除选日
            </Button>
          )}
        </div>
        {contributions.entriesBusy && (
          <p role="status" className="text-13 text-secondary">
            正在读取明细…
          </p>
        )}
        <div className="lab-contributions-entries">
          {entries?.results.map((entry) => (
            <button
              type="button"
              key={entry.id}
              aria-label={`查看贡献记录 ${entry.task_title} ${entry.day}`}
              className="lab-contributions-entry"
              onClick={() => {
                setChosen(entry);
                setShowBounty(false);
              }}
            >
              <span
                className={`lab-contributions-entry-icon ${entry.kind === "reversal" ? "lab-contributions-reversal" : ""}`}
                aria-hidden="true"
              >
                {entry.kind === "reversal" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
              </span>
              <span className="lab-contributions-entry-content">
                <strong>{entry.task_title}</strong>
                <span className="lab-contributions-entry-meta">
                  <span className="lab-contributions-project-tag" style={projectStyle(entry.project_id)}>
                    {entry.project}
                  </span>
                  <time dateTime={entry.created_at}>{timeFormat.format(new Date(entry.created_at))}</time>
                </span>
              </span>
              <span className="lab-contributions-entry-amount">
                <strong>
                  {entry.kind === "award" ? "+" : ""}
                  {entry.delta} VC
                </strong>
                <span>{entry.kind === "reversal" ? "冲正" : "获得"}</span>
              </span>
            </button>
          ))}
        </div>
        {entries?.results.length === 0 && !contributions.entriesBusy && (
          <p className="text-13 text-tertiary">暂无 VC 记录</p>
        )}
        {entries?.next_cursor && (
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="neutral-primary"
              loading={contributions.entriesBusy}
              onClick={() => void contributions.loadMore()}
            >
              加载更多
            </Button>
          </div>
        )}
      </section>
      {chosen && !(showBounty && sourceReady && currentEntry?.can_open_bounty) && (
        <LabItemOverviewSurface title="贡献记录" onClose={() => setChosen(undefined)}>
          <h2 className="text-20 font-semibold break-words">{chosen.task_title}</h2>
          <dl className="lab-contributions-record-details">
            <div>
              <dt>项目</dt>
              <dd>{chosen.project}</dd>
            </div>
            <div>
              <dt>记录时间</dt>
              <dd>{timeFormat.format(new Date(chosen.created_at))}</dd>
            </div>
            <div>
              <dt>记录类型</dt>
              <dd>{chosen.kind === "reversal" ? "冲正" : "获得"}</dd>
            </div>
            <div>
              <dt>VC 变化</dt>
              <dd>
                {chosen.kind === "award" ? "+" : ""}
                {chosen.delta} VC
              </dd>
            </div>
            {chosen.reverses && (
              <div>
                <dt>原记录</dt>
                <dd>{chosen.reverses}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            {sourceReady &&
              currentEntry?.can_open_issue &&
              currentEntry.task_id &&
              currentEntry.project_id &&
              (openProjectIssue ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setChosen(undefined);
                    openProjectIssue({
                      issue_id: currentEntry.task_id,
                      project_id: currentEntry.project_id,
                      archived: currentEntry.archived,
                    });
                  }}
                >
                  打开工作项
                </Button>
              ) : (
                <a
                  className="text-13 text-accent-primary"
                  href={`/${store.slug}/projects/${currentEntry.project_id}/issues/${currentEntry.task_id}`}
                >
                  打开工作项
                </a>
              ))}
            {sourceReady && currentEntry?.can_open_bounty && currentEntry.bounty_id && (
              <Button variant="neutral-primary" onClick={() => setShowBounty(true)}>
                打开悬赏任务
              </Button>
            )}
          </div>
        </LabItemOverviewSurface>
      )}
      {showBounty && sourceReady && currentEntry?.can_open_bounty && currentEntry.bounty_id && (
        <LabTaskOverview
          store={store}
          item={{ title: currentEntry.task_title, bounty_id: currentEntry.bounty_id }}
          onClose={() => setShowBounty(false)}
        />
      )}
    </div>
  );
});
