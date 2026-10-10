/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState, useRef } from "react";
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
      <div className="lab-heading">
        <h2>我的项目与 VC</h2>
        <Button onClick={() => void refresh().catch(() => {})}>刷新</Button>
      </div>
      <ErrorMessage error={summary.error || calendar.error || entries.error || error} />
      {summary.data && (
        <section className="lab-card">
          <span className="lab-muted">累计有效贡献 VC</span>
          <strong className="lab-amount-total">{summary.data.totals.net}</strong>
          <KeyValues values={{ 累计获得: summary.data.totals.earned, 已冲正: summary.data.totals.reversed }} />
        </section>
      )}
      <h3>我参与的项目</h3>
      {summary.data?.projects.map((row) => (
        <article className="lab-card" key={row.id}>
          <h3>{row.name}</h3>
          <p className="lab-muted">
            {row.participation
              .map((kind) => (kind === "project" ? "项目成员" : kind === "bounty" ? "悬赏参与" : "历史贡献"))
              .join(" · ")}
            {row.historical ? " · 历史项目" : ""}
          </p>
          <KeyValues values={{ 获得VC: row.earned, 冲正VC: row.reversed, 有效VC: row.net }} />
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
      <div className="lab-grid">
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
          <select
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
          </select>
        </LabField>
      </div>
      {calendar.data && (
        <KeyValues
          values={{
            本月获得: calendar.data.totals.earned,
            本月冲正: calendar.data.totals.reversed,
            本月有效: calendar.data.totals.net,
          }}
        />
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
              className={day === date ? "active" : ""}
              style={values.length ? { background: "var(--soft,#eef6f2)" } : undefined}
              aria-label={`${date} ${net} VC`}
              onClick={() => setDay(day === date ? "" : date)}
            >
              {Number(date.slice(-2))}
              <small>{values.length ? `${net}` : ""}</small>
            </button>
          );
        })}
      </div>
      <div className="lab-heading">
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
