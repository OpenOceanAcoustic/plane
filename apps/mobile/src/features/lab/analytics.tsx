/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { LabAnalytics, LabChart, LabChartRow, LabChartDetails } from "@plane/types";
import { CanonicalIcon } from "../../components/navigation";
import { PageHeading } from "../../components/ui";
import { ChartVisual } from "./charts";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { today } from "./business";
import { LabDialog, LabField, Button, ErrorMessage, KeyValues, Empty, DataRecords } from "./ui";
const displayNumber = (value: string | number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
function periodStart(days: number) {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() - days + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function exclusiveEnd(day: string) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function Analytics({
  store,
  onOpenIssue,
  onOpenProject,
}: {
  store: LabStore;
  onOpenIssue?: (project: string, issue: string) => void;
  onOpenProject?: (project: string) => void;
}) {
  const [start, setStart] = useState(() => periodStart(30));
  const [end, setEnd] = useState(today());
  const [range, setRange] = useState("30");
  const [project, setProject] = useState("");
  const [member, setMember] = useState("");
  const [team, setTeam] = useState(false);
  const [domain, setDomain] = useState("vc");
  const [trend, setTrend] = useState(false);
  const [filters, setFilters] = useState(false);
  const [chosen, setChosen] = useState<{ chart: LabChart; row: LabChartRow }>();
  const query = new URLSearchParams({ start, end: exclusiveEnd(end), team: team ? "1" : "0" });
  if (project) query.set("project_id", project);
  if (member) query.set("user_id", member);
  const resource = useResource<LabAnalytics>(store, `analytics/?${query}`);
  const details = useResource<LabChartDetails>(
    store,
    chosen
      ? `analytics/drilldown/?${query}&chart=${encodeURIComponent(chosen.chart.id)}&key=${encodeURIComponent(chosen.row.id)}`
      : null
  );
  const openRecord = (url: string) => {
    const issue = /\/projects\/([^/]+)\/issues\/([^/?#]+)/.exec(url);
    const projectMatch = /\/projects\/([^/?#]+)/.exec(url);
    if (issue && onOpenIssue) onOpenIssue(issue[1]!, issue[2]!);
    else if (projectMatch && onOpenProject) onOpenProject(projectMatch[1]!);
  };
  const visibleCharts = resource.data?.charts.filter(
    (chart) =>
      (domain === "all" || chart.domain === domain) &&
      (domain !== "vc" || ["vc-trend", "vc-acceptance"].includes(chart.id) === trend)
  );
  const title =
    domain === "vc" ? (trend ? "VC 趋势与验收" : "VC 数据") : domain === "schedule" ? "排期数据" : "数据总览";
  return (
    <>
      <PageHeading title={title}>
        <button className="icon-button" aria-label="筛选统计范围" onClick={() => setFilters(true)}>
          <CanonicalIcon name="sort" size={24} />
        </button>
      </PageHeading>
      <div className="m3-tabs bx-tabs bx-domain-tabs" role="tablist">
        {[
          { id: "all", name: "全部图表" },
          { id: "project", name: "项目" },
          { id: "schedule", name: "排期" },
          { id: "vc", name: "VC" },
        ].map((item) => (
          <button
            key={item.id}
            className={`bx-tab${domain === item.id ? " bx-selected" : ""}`}
            role="tab"
            aria-selected={domain === item.id}
            onClick={() => {
              setDomain(item.id);
              setTrend(false);
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <main className="bx-body bx-analytics-body">
        <ErrorMessage error={resource.error} />
        <div className="bx-stat-filters">
          <label className="bx-project-filter m3-chip v6-select-chip">
            <CanonicalIcon name="folder" size={18} />
            <span>{resource.data?.projects.find((row) => row.id === project)?.name ?? "全部项目"}</span>
            <CanonicalIcon name="down" size={18} />
            <select aria-label="统计项目" value={project} onChange={(event) => setProject(event.target.value)}>
              <option value="">全部项目</option>
              {resource.data?.projects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <details className="bx-date-filter">
            <summary>
              <span>{range === "7" ? "近七天" : range === "30" ? "近三十天" : "自定义"}</span>
              <CanonicalIcon name="down" size={18} />
            </summary>
            <div className="bx-date-menu">
              {[
                { id: "7", name: "近七天" },
                { id: "30", name: "近三十天" },
                { id: "custom", name: "自定义" },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={(event) => {
                    setRange(item.id);
                    if (item.id === "custom") setFilters(true);
                    else {
                      setStart(periodStart(Number(item.id)));
                      setEnd(today());
                    }
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </details>
        </div>
        {resource.loading && <Empty>正在读取统计…</Empty>}
        {domain === "vc" && !trend ? (
          <>
            {resource.data?.charts
              .find((chart) => chart.id === "vc-budget")
              ?.rows.map((row) => {
                const chart = resource.data!.charts.find((candidate) => candidate.id === "vc-budget")!;
                const total = Number(row.budget) || 0;
                const parts = [
                  { key: "available", label: "未占用", kind: "bx-unused" },
                  { key: "reserved", label: "占用未授予", kind: "bx-reserved" },
                  { key: "awarded", label: "已授予净额", kind: "bx-awarded" },
                ];
                return (
                  <section key={row.id} className="bx-vc-overview" aria-label="阶段预算占用，单位VC">
                    <div className="bx-overview-heading">
                      <h2>阶段预算占用</h2>
                      <span>{row.label.split(" · ").slice(1).join(" · ") || row.label}</span>
                    </div>
                    <div className="bx-total-row">
                      <button
                        className="bx-total v6-total-button"
                        aria-label={`查看 ${row.label} 预算明细`}
                        onClick={() => setChosen({ chart, row })}
                      >
                        {displayNumber(row.budget)}
                        <span>VC</span>
                      </button>
                      <button className="bx-trend" onClick={() => setTrend(true)}>
                        趋势与验收
                        <CanonicalIcon name="chevron" size={18} />
                      </button>
                    </div>
                    <div
                      className="bx-stack"
                      role="img"
                      aria-label={parts.map((part) => `${part.label} ${row[part.key]} VC`).join("，")}
                    >
                      {parts.map((part) => (
                        <span
                          key={part.key}
                          className={part.kind}
                          style={{
                            width: `${total > 0 ? (Math.max(0, Number(row[part.key]) || 0) / total) * 100 : 0}%`,
                          }}
                        />
                      ))}
                    </div>
                    <dl className="bx-stack-legend">
                      {parts.map((part) => (
                        <div key={part.key}>
                          <dt>
                            <i className={`bx-dot ${part.kind}`} />
                            {part.label}
                          </dt>
                          <dd>{displayNumber(row[part.key])}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}
            {(() => {
              const chart = resource.data?.charts.find((row) => row.id === "vc-participants");
              const maximum = Math.max(
                1,
                ...(chart?.rows ?? []).flatMap((row) => [Number(row.planned) || 0, Number(row.awarded) || 0])
              );
              return chart ? (
                <section className="bx-contribution">
                  <h2>项目成员计划与实际贡献</h2>
                  <div className="bx-member-legend">
                    <span>
                      <i className="bx-dot bx-planned" />
                      批准的计划 VC
                    </span>
                    <span>
                      <i className="bx-dot bx-actual" />
                      实际净 VC
                    </span>
                  </div>
                  <div className="bx-axis">
                    <span>0</span>
                    <span>{displayNumber(maximum / 2)}</span>
                    <span>{displayNumber(maximum)} VC</span>
                  </div>
                  {chart.rows
                    .slice()
                    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022; sorts a new copy by the displayed member name
                    .sort(
                      (left, right) => left.label.localeCompare(right.label, "zh-CN") || left.id.localeCompare(right.id)
                    )
                    .map((row) => (
                      <button
                        className="bx-person v6-person-button"
                        key={row.id}
                        onClick={() => setChosen({ chart, row })}
                      >
                        <div className="bx-person-heading">
                          <span>{row.label}</span>
                          <span>
                            <b>{displayNumber(row.planned)}</b> / <b>{displayNumber(row.awarded)}</b>
                            <small>VC</small>
                          </span>
                        </div>
                        <div
                          className="bx-member-chart"
                          aria-label={`${row.label}，批准的计划 ${row.planned} VC，实际净 ${row.awarded} VC`}
                        >
                          <div className="bx-member-track">
                            <span
                              className="bx-planned"
                              style={{ width: `${(Math.max(0, Number(row.planned) || 0) / maximum) * 100}%` }}
                            />
                          </div>
                          <div className="bx-member-track">
                            <span
                              className="bx-actual"
                              style={{ width: `${(Math.max(0, Number(row.awarded) || 0) / maximum) * 100}%` }}
                            />
                          </div>
                        </div>
                      </button>
                    ))}
                  {!chart.rows.length && <Empty>{project ? "暂无成员贡献" : "请选择项目"}</Empty>}
                </section>
              ) : null;
            })()}
            <details className="bx-data-details">
              <summary>
                <span>阶段预算明细</span>
                <CanonicalIcon name="down" size={20} className="bx-expander" />
              </summary>
              {resource.data?.charts
                .find((chart) => chart.id === "vc-budget")
                ?.rows.map((row) => (
                  <div key={row.id}>
                    <div className="bx-data-stage">
                      <span>阶段</span>
                      <strong>{row.label.split(" · ").slice(1).join(" · ") || row.label}</strong>
                    </div>
                    <dl className="bx-data-rows">
                      {[
                        { key: "budget", label: "预算 B" },
                        { key: "available", label: "未占用" },
                        { key: "reserved", label: "占用未授予" },
                        { key: "awarded", label: "已授予净额" },
                      ].map((field) => (
                        <div key={field.key}>
                          <dt>{field.label}</dt>
                          <dd>{displayNumber(row[field.key])} VC</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
            </details>
            {!resource.loading && !resource.data?.charts.find((chart) => chart.id === "vc-budget")?.rows.length && (
              <Empty>暂无阶段预算</Empty>
            )}
          </>
        ) : (
          <>
            {domain === "vc" && <Button onClick={() => setTrend(false)}>预算与贡献</Button>}
            {visibleCharts?.map((chart) => (
              <section key={chart.id} className="lab-analytics-section" aria-label={chart.title}>
                <div className="lab-section-heading">
                  <h2>{chart.title}</h2>
                </div>
                <ChartVisual chart={chart} onSelect={(row) => setChosen({ chart, row })} />
                <DataRecords columns={chart.columns} rows={chart.rows} onSelect={(row) => setChosen({ chart, row })} />
                {!chart.rows.length && <Empty />}
              </section>
            ))}
          </>
        )}
      </main>
      {filters && (
        <LabDialog
          title="统计筛选"
          onClose={() => setFilters(false)}
          submitLabel="应用筛选"
          onSubmit={() => setFilters(false)}
        >
          <LabField label="开始日期">
            <input
              type="date"
              value={start}
              max={end}
              onChange={(event) => {
                setStart(event.target.value);
                setRange("custom");
              }}
            />
          </LabField>
          <LabField label="结束日期">
            <input
              type="date"
              value={end}
              min={start}
              onChange={(event) => {
                setEnd(event.target.value);
                setRange("custom");
              }}
            />
          </LabField>
          <LabField label="成员">
            <select value={member} onChange={(event) => setMember(event.target.value)}>
              <option value="">全部成员</option>
              {resource.data?.members.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          {resource.data?.can_view_team && (
            <label className="lab-switch-field">
              查看团队统计
              <input type="checkbox" checked={team} onChange={(event) => setTeam(event.target.checked)} />
            </label>
          )}
        </LabDialog>
      )}
      {chosen && (
        <LabDialog title={`${chosen.chart.title} · ${chosen.row.label}`} onClose={() => setChosen(undefined)}>
          <ErrorMessage error={details.error} />
          {details.loading && <Empty>正在读取明细…</Empty>}
          {details.data?.records.map((row) => (
            <article className="lab-card" key={row.url ?? JSON.stringify(row)}>
              <h3>{row.title}</h3>
              <KeyValues
                values={Object.fromEntries(details.data!.columns.map((column) => [column.label, row[column.key]]))}
              />
              {row.url && /\/projects\//.test(row.url) && (
                <Button onClick={() => openRecord(row.url!)}>打开记录</Button>
              )}
            </article>
          ))}
          {details.data && !details.data.records.length && <Empty />}
        </LabDialog>
      )}
    </>
  );
}
