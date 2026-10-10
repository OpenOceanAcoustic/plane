/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { MobileSelect } from "../../components/select";
import { useState, useRef } from "react";
import { PageHeading } from "../../components/ui";
import type { LabContributionsSummary, LabContributionsCalendar, LabContributionsEntries } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { today, monthDays, contributionQuery } from "./business";
import { labDecimalText, labDecimalUnits, Button, LabField, ErrorMessage, Empty, KeyValues } from "./ui";
export function Contributions({
  store,
  onOpenIssue,
  onOpenProject,
  onOpenBounty,
}: {
  store: LabStore;
  onOpenIssue?: (project: string, issue: string) => void;
  onOpenProject?: (project: string) => void;
  onOpenBounty: (id: string) => void;
}) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [project, setProject] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const summary = useResource<LabContributionsSummary>(store, "me/contributions/");
  const calendar = useResource<LabContributionsCalendar>(
    store,
    `me/contributions/calendar/?${contributionQuery(month, project)}`
  );
  const entries = useResource<LabContributionsEntries>(
    store,
    `me/contributions/entries/?${contributionQuery(month, project, day)}`
  );
  const refresh = async () => {
    await Promise.all([summary.refresh(), calendar.refresh(), entries.refresh()]);
  };
  const selectedRange = useRef("");
  selectedRange.current = `${store.scope}:${month}:${project}:${day}`;
  const loadMore = async () => {
    if (!entries.data?.next_cursor || busy) return;
    setBusy(true);
    setError("");
    const range = selectedRange.current;
    try {
      const next = await store.request<LabContributionsEntries>(
        `me/contributions/entries/?${contributionQuery(month, project, day, entries.data.next_cursor)}`
      );
      if (range !== selectedRange.current) return;
      entries.setData((current) =>
        current
          ? {
              ...next,
              results: [...new Map([...current.results, ...next.results].map((row) => [row.id, row])).values()],
            }
          : next
      );
    } catch (e) {
      if (range === selectedRange.current) setError(e instanceof Error ? e.message : "读取下一页失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading title="我的项目与 VC">
        <Button onClick={() => void refresh().catch(() => {})}>刷新</Button>
      </PageHeading>
      <ErrorMessage error={summary.error || calendar.error || entries.error || error} />
      {summary.data && (
        <>
          <div className="lab-hero">
            <span>累计有效贡献 VC</span>
            <strong>{summary.data.totals.net} VC</strong>
          </div>
          <div className="lab-stats two">
            <div className="lab-stat">
              <span>累计获得</span>
              <strong>{summary.data.totals.earned} VC</strong>
            </div>
            <div className="lab-stat">
              <span>已冲正</span>
              <strong>{summary.data.totals.reversed} VC</strong>
            </div>
          </div>
        </>
      )}
      <h3 className="lab-section-heading">我参与的项目</h3>
      {summary.data?.projects.map((row) => (
        <article className="lab-card" key={row.id}>
          <h3>{row.name}</h3>
          <p className="lab-muted">
            {row.participation
              .map((kind) => (kind === "project" ? "项目成员" : kind === "bounty" ? "悬赏参与" : "历史贡献"))
              .join(" · ")}
            {row.historical ? " · 历史项目" : ""}
          </p>
          <div className="lab-card-meta">
            <span>有效 {row.net} VC</span>
            <span>获得 {row.earned} VC</span>
            <span>冲正 {row.reversed} VC</span>
          </div>
          <div className="lab-actions">
            <Button
              onClick={() => {
                setProject(row.id);
                setDay("");
              }}
            >
              查看贡献记录
            </Button>
            {row.can_open_project && onOpenProject && <Button onClick={() => onOpenProject(row.id)}>打开项目</Button>}
          </div>
        </article>
      ))}
      {summary.data && !summary.data.projects.length && <Empty>尚无项目参与记录。</Empty>}
      <h3 className="lab-section-heading">贡献日历</h3>
      <div className="lab-form-fields">
        <LabField label="贡献月份">
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (!e.target.value) return;
              setMonth(e.target.value);
              setDay("");
            }}
          />
        </LabField>
        <LabField label="项目">
          <MobileSelect
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setDay("");
            }}
          >
            <option value="">全部项目</option>
            {summary.data?.projects.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </MobileSelect>
        </LabField>
      </div>
      {calendar.data && (
        <div className="lab-stats">
          {[
            ["本月获得", calendar.data.totals.earned],
            ["本月冲正", calendar.data.totals.reversed],
            ["本月有效", calendar.data.totals.net],
          ].map(([label, value]) => (
            <div className="lab-stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="lab-month">
        {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
          <span key={label}>{label}</span>
        ))}
        {Array.from({ length: (new Date(`${month}-01T12:00:00+08:00`).getUTCDay() + 6) % 7 }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {monthDays(month).map((date) => {
          const values = calendar.data?.days.filter((row) => row.day === date) ?? [];
          const net = labDecimalText(values.reduce((sum, row) => sum + (labDecimalUnits(row.net) ?? 0n), 0n));
          return (
            <button
              key={date}
              className={`${day === date ? "active" : ""} ${values.length ? "marked" : ""}`}
              aria-label={`${date} ${net} VC`}
              onClick={() => setDay(day === date ? "" : date)}
            >
              {Number(date.slice(-2))}
              <small>{values.length ? `${net}` : ""}</small>
            </button>
          );
        })}
      </div>
      <div className="lab-section-heading">
        <h3>{day || "本月"}贡献记录</h3>
        {day && <Button onClick={() => setDay("")}>查看整月</Button>}
      </div>
      {entries.data?.results.map((row) => (
        <article className="lab-card" key={row.id}>
          <h3>{row.task_title}</h3>
          <KeyValues
            values={{
              项目: row.project,
              日期: row.day,
              VC变化: row.delta,
              类型: row.kind === "award" ? "贡献授予" : "冲正更正",
              登记时间: row.created_at,
              归档: row.archived ? "是" : "否",
            }}
          />
          <div className="lab-actions">
            {row.can_open_issue && onOpenIssue && (
              <Button onClick={() => onOpenIssue(row.project_id, row.task_id)}>任务详情</Button>
            )}
            {row.can_open_bounty && <Button onClick={() => onOpenBounty(row.bounty_id)}>悬赏详情</Button>}
          </div>
        </article>
      ))}
      {entries.data && !entries.data.results.length && <Empty>所选范围暂无贡献记录。</Empty>}
      {entries.data?.next_cursor && (
        <Button disabled={busy} onClick={() => void loadMore()}>
          {busy ? "正在读取…" : "更多贡献记录"}
        </Button>
      )}
    </>
  );
}
