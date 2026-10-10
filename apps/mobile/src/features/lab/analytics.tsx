/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { LabAnalytics, LabChart, LabChartRow, LabChartDetails } from "@plane/types";
import { PageHeading } from "../../components/ui";
import { ChartVisual } from "./charts";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { today } from "./business";
import { LabDialog, LabField, Button, Tabs, ErrorMessage, KeyValues, Empty, DataRecords } from "./ui";
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
  const [domain, setDomain] = useState("all");
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
      <PageHeading title={title} />
      <div className="lab-context-actions">
        <Button variant="primary" onClick={() => setFilters(true)}>
          筛选
        </Button>
        {domain === "vc" && (
          <Button onClick={() => setTrend((value) => !value)}>{trend ? "预算与贡献" : "趋势与验收"}</Button>
        )}
      </div>
      <ErrorMessage error={resource.error} />
      <LabField label="统计项目">
        <select value={project} onChange={(event) => setProject(event.target.value)}>
          <option value="">全部项目</option>
          {resource.data?.projects.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </LabField>
      <div className="lab-actions lab-period-chips">
        {[
          { id: "7", name: "近七天" },
          { id: "30", name: "近三十天" },
          { id: "custom", name: "自定义" },
        ].map((item) => (
          <button
            type="button"
            key={item.id}
            className={`lab-chip ${range === item.id ? "active" : ""}`}
            onClick={() => {
              setRange(item.id);
              if (item.id === "custom") setFilters(true);
              else {
                setStart(periodStart(Number(item.id)));
                setEnd(today());
              }
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <Tabs
        items={[
          { id: "all", name: "全部图表" },
          { id: "project", name: "项目" },
          { id: "schedule", name: "排期" },
          { id: "vc", name: "VC" },
        ]}
        value={domain}
        onChange={(value) => {
          setDomain(value);
          setTrend(false);
        }}
      />
      {resource.loading && <Empty>正在读取统计…</Empty>}
      {visibleCharts?.map((chart) => (
        <section key={chart.id} className="lab-analytics-section" aria-label={chart.title}>
          <div className="lab-section-heading">
            <h2>{chart.title}</h2>
          </div>
          <ChartVisual chart={chart} onSelect={(row) => setChosen({ chart, row })} />
          {chart.note && <p className="lab-chart-note">{chart.note}</p>}
          <DataRecords columns={chart.columns} rows={chart.rows} onSelect={(row) => setChosen({ chart, row })} />
          {!chart.rows.length && <Empty />}
        </section>
      ))}
      {domain === "vc" && visibleCharts?.some((chart) => chart.id === "vc-participants" && chart.rows.length) && (
        <Button
          onClick={() => {
            const chart = visibleCharts.find(
              (candidate) => candidate.id === "vc-participants" && candidate.rows.length
            );
            if (chart) setChosen({ chart, row: chart.rows[0]! });
          }}
        >
          查看贡献明细
        </Button>
      )}
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
