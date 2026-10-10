/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { ChartVisual } from "./charts";
import type { LabAnalytics, LabChart, LabChartRow, LabChartDetails } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { today } from "./business";
import { LabDialog, LabField, Button, Tabs, ErrorMessage, KeyValues, Empty } from "./ui";
export function Analytics({
  store,
  onOpenIssue,
  onOpenProject,
}: {
  store: LabStore;
  onOpenIssue?: (project: string, issue: string) => void;
  onOpenProject?: (project: string) => void;
}) {
  const [start, setStart] = useState(`${today().slice(0, 7)}-01`);
  const [end, setEnd] = useState(today());
  const [project, setProject] = useState("");
  const [member, setMember] = useState("");
  const [team, setTeam] = useState(false);
  const [domain, setDomain] = useState("project");
  const [chosen, setChosen] = useState<{ chart: LabChart; row: LabChartRow }>();
  const query = new URLSearchParams({ start, end, team: team ? "1" : "0" });
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
    const issue = /\/projects\/([^/]+)\/issues\/([^/?#]+)/.exec(url),
      projectMatch = /\/projects\/([^/?#]+)/.exec(url);
    if (issue && onOpenIssue) onOpenIssue(issue[1]!, issue[2]!);
    else if (projectMatch && onOpenProject) onOpenProject(projectMatch[1]!);
  };
  return (
    <>
      <div className="lab-heading">
        <h2>数据总览</h2>
        <Button onClick={() => void resource.refresh().catch(() => {})}>刷新</Button>
      </div>
      <ErrorMessage error={resource.error} />
      <div className="lab-grid">
        <LabField label="开始日期">
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </LabField>
        <LabField label="结束日期">
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </LabField>
        <LabField label="项目">
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">全部项目</option>
            {resource.data?.projects.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </LabField>
        <LabField label="成员">
          <select value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="">全部成员</option>
            {resource.data?.members.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </LabField>
      </div>
      {resource.data?.can_view_team && (
        <label>
          <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} />
          查看团队统计
        </label>
      )}
      <Tabs
        items={[
          { id: "project", name: "项目" },
          { id: "schedule", name: "排期" },
          { id: "vc", name: "VC" },
        ]}
        value={domain}
        onChange={setDomain}
      />
      {resource.loading && <Empty>正在读取统计…</Empty>}
      {resource.data?.charts
        .filter((chart) => chart.domain === domain)
        .map((chart) => {
          const max = Math.max(
            1,
            ...chart.rows.map((row) =>
              chart.series.reduce(
                (sum, series) =>
                  sum +
                  (typeof row[series.key] === "number"
                    ? Math.abs(row[series.key] as number)
                    : Number(row[series.key]) || 0),
                0
              )
            )
          );
          return (
            <section key={chart.id} className="lab-card" aria-label={chart.title}>
              <h3>{chart.title}</h3>
              <p className="lab-muted">
                {chart.note} · {chart.unit}
              </p>
              <ChartVisual chart={chart} onSelect={(row) => setChosen({ chart, row })} />
              <details>
                <summary>查看数据记录</summary>
                {chart.rows.map((row) => (
                  <button key={row.id} className="lab-card-row" onClick={() => setChosen({ chart, row })}>
                    <strong>{row.label}</strong>
                    {chart.series.map((series) => (
                      <div key={series.key}>
                        <div className="lab-heading">
                          <span className="lab-muted">{series.label}</span>
                          <span>{row[series.key] ?? "—"}</span>
                        </div>
                        <div className="lab-bar">
                          <span
                            style={{ width: `${Math.min(100, (Math.abs(Number(row[series.key]) || 0) * 100) / max)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <KeyValues
                      values={Object.fromEntries(
                        chart.columns
                          .filter(
                            (column) =>
                              column.key !== "label" && !chart.series.some((series) => series.key === column.key)
                          )
                          .map((column) => [column.label, row[column.key]])
                      )}
                    />
                  </button>
                ))}
                {!chart.rows.length && <Empty />}
              </details>
            </section>
          );
        })}
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
