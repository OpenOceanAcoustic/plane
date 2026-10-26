/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
// oxlint-disable-next-line import/no-unassigned-import -- synchronized work item timeline
import "./task-timeline.css";

export type TaskTimelineRow = {
  id: string;
  title: string;
  kind: "project" | "personal" | "group";
  start: string | null;
  end: string | null;
  depth: number;
};

type Scale = "day" | "week";
const DAY_MS = 86_400_000;
const MIN_DAY = Math.floor(Date.parse("0001-01-01T00:00:00Z") / DAY_MS);
const MAX_DAY = Math.floor(Date.parse("9999-12-31T00:00:00Z") / DAY_MS);
const windows = { day: { days: 42, dayWidth: 32, step: 1 }, week: { days: 84, dayWidth: 12, step: 7 } };
const dayText = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const shortDay = (day: number) => dayText(day).slice(5).replace("-", "/");
const clampStart = (day: number, days: number) => Math.min(MAX_DAY - days + 1, Math.max(MIN_DAY, day));
const monday = (day: number) => day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);

export function timelineDay(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  const day = Math.floor(time / DAY_MS);
  return day >= MIN_DAY && day <= MAX_DAY ? day : null;
}

function todayInTimezone(timezone: string): number {
  const fields = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => fields.find((field) => field.type === type)!.value;
  return timelineDay(`${get("year")}-${get("month")}-${get("day")}`)!;
}

function nearestDate(rows: TaskTimelineRow[], today: number): number {
  let nearest = today;
  let distance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.kind === "group") continue;
    const start = timelineDay(row.start);
    const end = timelineDay(row.end);
    if (start !== null && end !== null && start <= today && today <= end) return today;
    for (const day of [start, end]) {
      if (day !== null && Math.abs(day - today) < distance) {
        nearest = day;
        distance = Math.abs(day - today);
      }
    }
  }
  return nearest;
}

export function LabTaskTimeline({ rows, workspaceTimezone }: { rows: TaskTimelineRow[]; workspaceTimezone: string }) {
  const [today, setToday] = useState(() => todayInTimezone(workspaceTimezone));
  const [scale, setScale] = useState<Scale>("day");
  const [rangeStart, setRangeStart] = useState(() => clampStart(nearestDate(rows, today) - 7, windows.day.days));
  const initialized = useRef(rows.some((row) => row.kind !== "group" && (row.start || row.end)));
  const scroller = useRef<HTMLDivElement>(null);
  const { days, dayWidth, step } = windows[scale];
  const start = clampStart(rangeStart, days);
  const end = start + days - 1;
  const width = days * dayWidth;
  useEffect(() => {
    const refresh = () => setToday(todayInTimezone(workspaceTimezone));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [workspaceTimezone]);
  useEffect(() => {
    if (initialized.current || !rows.some((row) => row.kind !== "group" && (row.start || row.end))) return;
    initialized.current = true;
    setRangeStart(clampStart(nearestDate(rows, today) - 7, windows.day.days));
  }, [rows, today]);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = 0;
  }, [start, scale]);
  const months = useMemo(() => {
    const result: { label: string; days: number }[] = [];
    for (let offset = 0; offset < days; offset++) {
      const date = dayText(start + offset);
      const label = `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`;
      const previous = result[result.length - 1];
      if (previous?.label === label) previous.days += 1;
      else result.push({ label, days: 1 });
    }
    return result;
  }, [start, days]);
  const ticks = Array.from({ length: days / step }, (_, index) => start + index * step);
  const navigate = (day: number) => {
    initialized.current = true;
    setRangeStart(clampStart(scale === "week" ? monday(day) : day, days));
  };
  return (
    <section className="lab-task-timeline" aria-label="工作项甘特图">
      <div className="lab-task-timeline-toolbar">
        <select
          aria-label="甘特时间尺度"
          value={scale}
          onChange={(event) => {
            const next = event.target.value as Scale;
            setScale(next);
            setRangeStart(clampStart(next === "week" ? monday(start) : start, windows[next].days));
          }}
        >
          <option value="day">日</option>
          <option value="week">周</option>
        </select>
        <button
          type="button"
          aria-label="前一段时间"
          disabled={start === MIN_DAY}
          onClick={() => navigate(start - days)}
        >
          <ChevronLeft size={14} />
        </button>
        <button type="button" onClick={() => navigate(today - (scale === "week" ? 14 : 7))}>
          今天
        </button>
        <button type="button" aria-label="后一段时间" disabled={end === MAX_DAY} onClick={() => navigate(start + days)}>
          <ChevronRight size={14} />
        </button>
        <button type="button" onClick={() => navigate(nearestDate(rows, today) - (scale === "week" ? 14 : 7))}>
          定位任务
        </button>
        <span className="lab-task-timeline-range" title={`${dayText(start)} 至 ${dayText(end)} · ${workspaceTimezone}`}>
          {dayText(start)} — {dayText(end)}
        </span>
      </div>
      <div className="lab-task-timeline-scroll" ref={scroller}>
        <div className="lab-task-timeline-canvas" style={{ width }}>
          <div className="lab-task-timeline-head" aria-label="甘特日期表头">
            <div className="lab-task-timeline-months">
              {months.map((month) => (
                <span key={month.label} style={{ width: month.days * dayWidth }}>
                  {month.label}
                </span>
              ))}
            </div>
            <div className="lab-task-timeline-ticks">
              {ticks.map((day) => (
                <span
                  key={day}
                  style={{ width: step * dayWidth }}
                  data-today={(day <= today && today < day + step) || undefined}
                >
                  {scale === "day" ? Number(dayText(day).slice(8)) : shortDay(day)}
                </span>
              ))}
            </div>
          </div>
          <div className="lab-task-timeline-rows" style={{ backgroundSize: `${step * dayWidth}px 38px` }}>
            {rows.map((row) => {
              const first = timelineDay(row.start);
              const last = timelineDay(row.end);
              const valid = first !== null && last !== null && first <= last;
              const visible = valid && first <= end && last >= start;
              const description = `${row.title}：${row.start || "未设置开始日期"} 至 ${row.end || "未设置结束日期"}`;
              const left = visible ? (Math.max(first, start) - start) * dayWidth : 0;
              const barWidth = visible ? (Math.min(last, end) - Math.max(first, start) + 1) * dayWidth : 0;
              const missing =
                row.start && row.end
                  ? valid
                    ? `范围外：${row.start} — ${row.end}`
                    : "日期范围无效"
                  : row.start
                    ? `仅开始：${row.start}`
                    : row.end
                      ? `仅结束：${row.end}`
                      : "未排期";
              return (
                <div className="lab-task-timeline-row" data-row-id={row.id} data-kind={row.kind} key={row.id}>
                  {row.kind !== "group" &&
                    (visible ? (
                      <div
                        role="img"
                        aria-label={description}
                        title={description}
                        data-testid={`timeline-bar-${row.id}`}
                        className="lab-task-timeline-bar"
                        data-kind={row.kind}
                        data-clipped-start={first < start || undefined}
                        data-clipped-end={last > end || undefined}
                        style={{ left, width: barWidth }}
                      >
                        <span>{row.title}</span>
                      </div>
                    ) : (
                      <span className="lab-task-timeline-unscheduled" title={description}>
                        {missing}
                      </span>
                    ))}
                </div>
              );
            })}
            {start <= today && today <= end && (
              <span
                className="lab-task-timeline-today"
                role="img"
                aria-label={`今天 ${dayText(today)}`}
                style={{ left: (today - start + 0.5) * dayWidth }}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
