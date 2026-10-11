/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { CSSProperties } from "react";
import type { LabChart, LabChartRow } from "@plane/types";
const palette = ["var(--accent)", "var(--green)", "var(--tertiary)", "#97b4e6", "var(--secondary)"];
const number = (row: LabChartRow, key: string) => Number(row[key]) || 0;
function seriesColors(chart: LabChart) {
  if (chart.id === "vc-budget") return ["var(--green)", "var(--accent)", "var(--tertiary)"];
  if (chart.id === "vc-participants") return ["#97b4e6", "var(--accent)"];
  return palette;
}
export function ChartVisual({ chart, onSelect }: { chart: LabChart; onSelect: (row: LabChartRow) => void }) {
  if (!chart.rows.length) return null;
  const colors = seriesColors(chart);
  const legend = (
    <div className="lab-series-legend">
      {chart.series.map((series, index) => (
        <span key={series.key}>
          <i style={{ background: colors[index % colors.length] }} />
          {series.label}
        </span>
      ))}
    </div>
  );
  if (chart.kind === "donut") {
    const key = chart.series[0]?.key;
    if (!key) return null;
    const total = chart.rows.reduce((sum, row) => sum + Math.max(0, number(row, key)), 0);
    let previous = 0;
    const stops = chart.rows
      .map((row, index) => {
        const start = previous;
        previous += total ? (Math.max(0, number(row, key)) * 100) / total : 0;
        return `${palette[index % palette.length]} ${start}% ${previous}%`;
      })
      .join(",");
    return (
      <div className="lab-chart-card lab-donut-layout">
        <div
          className="lab-donut"
          role="img"
          aria-label={`${chart.title}，总计 ${total} ${chart.unit}`}
          style={{ background: total ? `conic-gradient(${stops})` : "var(--layer)" }}
        >
          <span>
            <strong>{total}</strong>
            <small>{chart.unit}</small>
          </span>
        </div>
        <div className="lab-donut-legend">
          {chart.rows.map((row, index) => (
            <button key={row.id} type="button" onClick={() => onSelect(row)}>
              <i style={{ background: palette[index % palette.length] }} />
              <span>{row.label}</span>
              <strong>{row[key]}</strong>
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (chart.kind === "line") {
    const values = chart.rows.flatMap((row) => chart.series.map((series) => number(row, series.key)));
    const low = Math.min(0, ...values),
      high = Math.max(1, ...values);
    const x = (index: number) => 16 + (index * 310) / Math.max(1, chart.rows.length - 1);
    const y = (value: number) => 150 - ((value - low) * 115) / (high - low);
    return (
      <div className="lab-chart-card">
        {legend}
        <svg className="lab-chart-svg" viewBox="0 0 342 174" role="img" aria-label={chart.title}>
          {[35, 73, 112, 150].map((level) => (
            <line key={level} x1="16" y1={level} x2="326" y2={level} stroke="var(--line)" strokeDasharray="3 4" />
          ))}
          {chart.series.map((series, index) => (
            <g key={series.key}>
              <polyline
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth="2.5"
                points={chart.rows.map((row, i) => `${x(i)},${y(number(row, series.key))}`).join(" ")}
              />
              {chart.rows.map((row, i) => (
                <g
                  key={row.id}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- keyboard accessible SVG data points
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.label} ${series.label} ${row[series.key]}`}
                  onClick={() => onSelect(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(row);
                    }
                  }}
                >
                  <circle cx={x(i)} cy={y(number(row, series.key))} r="10" fill="transparent" />
                  <circle
                    cx={x(i)}
                    cy={y(number(row, series.key))}
                    r="3"
                    fill="var(--surface)"
                    stroke={colors[index % colors.length]}
                    strokeWidth="2"
                  />
                </g>
              ))}
            </g>
          ))}
        </svg>
        <div className="lab-line-labels">
          {chart.rows.map((row) => (
            <span key={row.id}>{row.label}</span>
          ))}
        </div>
        <div className="lab-chart-legend">{chart.unit}</div>
      </div>
    );
  }
  if (chart.kind === "heatmap" && chart.days && chart.members) {
    const members = chart.members;
    const rowsById = new Map(chart.rows.map((row) => [row.id, row]));
    const key = chart.series[0]?.key ?? "hours";
    const maximum = Math.max(1, ...chart.rows.map((row) => number(row, key)));
    const weeks = Array.from({ length: Math.ceil(chart.days.length / 7) }, (_, index) =>
      chart.days!.slice(index * 7, index * 7 + 7)
    );
    return (
      <div className="lab-heatmap-weeks">
        {weeks.map((days) => (
          <div
            key={days[0]}
            className="lab-chart-card lab-heatmap-chart"
            style={{ "--heatmap-days": days.length } as CSSProperties}
          >
            {weeks.length > 1 && (
              <p className="lab-chart-note">
                {days[0]} — {days[days.length - 1]}
              </p>
            )}
            <div className="lab-heatmap-head">
              <span />
              {days.map((day) => (
                <small key={day}>{Number(day.slice(-2))}</small>
              ))}
            </div>
            {members.map((member) => (
              <div className="lab-heatmap-row" key={member.id}>
                <strong>{member.name}</strong>
                {days.map((day) => {
                  const row = rowsById.get(`${member.id}:${day}`);
                  return (
                    <button
                      type="button"
                      key={day}
                      disabled={!row}
                      aria-label={`${member.name} ${day} ${row ? row[key] : 0} ${chart.unit}`}
                      style={
                        {
                          "--heat-strength": row
                            ? Math.min(0.8, Math.max(0.05, (number(row, key) * 0.8) / maximum))
                            : 0,
                        } as CSSProperties
                      }
                      onClick={() => row && onSelect(row)}
                    >
                      {row ? String(row[key] ?? "0") : "0"}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="lab-chart-legend">{chart.unit}</div>
          </div>
        ))}
      </div>
    );
  }
  if (chart.kind === "stack") {
    const max = Math.max(
      1,
      ...chart.rows.map((row) => chart.series.reduce((sum, series) => sum + Math.abs(number(row, series.key)), 0))
    );
    return (
      <div className="lab-chart-card">
        {legend}
        {chart.rows.map((row) => (
          <button className="lab-chart-row" type="button" key={row.id} onClick={() => onSelect(row)}>
            <span className="lab-stacked-label">{row.label}</span>
            <span className="lab-stacked-bar">
              {chart.series.map((series, index) => (
                <span
                  key={series.key}
                  style={{
                    width: `${(Math.abs(number(row, series.key)) * 100) / max}%`,
                    background: colors[index % colors.length],
                  }}
                >
                  {row[series.key]}
                </span>
              ))}
            </span>
          </button>
        ))}
        <div className="lab-chart-legend">
          {chart.unit} · {max}
        </div>
      </div>
    );
  }
  const max = Math.max(
    1,
    ...chart.rows.flatMap((row) => chart.series.map((series) => Math.abs(number(row, series.key))))
  );
  return (
    <div className="lab-chart-card">
      {legend}
      {chart.rows.map((row) => (
        <button className="lab-multi-bar-row" type="button" key={row.id} onClick={() => onSelect(row)}>
          <span>{row.label}</span>
          <span>
            {chart.series.map((series, index) => (
              <span className="lab-multi-bar-value" key={series.key}>
                <i
                  style={{
                    width: `${Math.max(2, (Math.abs(number(row, series.key)) * 100) / max)}%`,
                    background: colors[index % colors.length],
                  }}
                />
                <small>{row[series.key] ?? "—"}</small>
              </span>
            ))}
          </span>
        </button>
      ))}
      <div className="lab-chart-legend">{chart.unit}</div>
    </div>
  );
}
