/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { LabChart, LabChartRow } from "@plane/types";
const colors = ["#3b8870", "#3274ad", "#ad7840", "#8063a8", "#a16487", "#bc4b51"];
const number = (row: LabChartRow, key: string) => Number(row[key]) || 0;
export function ChartVisual({ chart, onSelect }: { chart: LabChart; onSelect: (row: LabChartRow) => void }) {
  if (!chart.rows.length) return null;
  if (chart.kind === "donut") {
    const key = chart.series[0]?.key;
    if (!key) return null;
    const total = chart.rows.reduce((sum, row) => sum + Math.max(0, number(row, key)), 0);
    let previous = 0;
    const stops = chart.rows
      .map((row, index) => {
        const start = previous;
        previous += total ? (Math.max(0, number(row, key)) * 100) / total : 0;
        return `${colors[index % colors.length]} ${start}% ${previous}%`;
      })
      .join(",");
    return (
      <div className="lab-donut-layout">
        <div
          className="lab-donut"
          role="img"
          aria-label={`${chart.title}，总计 ${total} ${chart.unit}`}
          style={{ background: total ? `conic-gradient(${stops})` : "var(--layer,#f4f5f5)" }}
        >
          <span>
            {total}
            <small>{chart.unit}</small>
          </span>
        </div>
        <div>
          {chart.rows.map((row, index) => (
            <button key={row.id} className="lab-card-row" onClick={() => onSelect(row)}>
              <i style={{ background: colors[index % colors.length] }} />
              {row.label} · {row[key]}
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
    const x = (index: number) => 12 + (index / Math.max(1, chart.rows.length - 1)) * 296;
    const y = (value: number) => 140 - ((value - low) / (high - low)) * 120;
    return (
      <div>
        <svg className="lab-chart-svg" viewBox="0 0 320 170" role="img" aria-label={chart.title}>
          <line x1="12" y1="140" x2="308" y2="140" stroke="currentColor" opacity=".2" />
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
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG data points need keyboard-accessible interaction
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.label} ${series.label} ${row[series.key]}`}
                  onClick={() => onSelect(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onSelect(row);
                  }}
                >
                  <circle cx={x(i)} cy={y(number(row, series.key))} r="10" fill="transparent" />
                  <circle cx={x(i)} cy={y(number(row, series.key))} r="3.5" fill={colors[index % colors.length]} />
                </g>
              ))}
            </g>
          ))}
          <text x="12" y="163" fill="currentColor" fontSize="10">
            {chart.rows[0]!.label}
          </text>
          <text x="308" y="163" textAnchor="end" fill="currentColor" fontSize="10">
            {chart.rows.at(-1)!.label}
          </text>
        </svg>
        <p className="lab-muted">{chart.series.map((series) => series.label).join(" · ")}</p>
      </div>
    );
  }
  if (chart.kind === "heatmap" && chart.days && chart.members) {
    const key = chart.series[0]?.key ?? "hours";
    const maximum = Math.max(1, ...chart.rows.map((row) => number(row, key)));
    return (
      <div>
        {chart.members.map((member) => (
          <section key={member.id}>
            <p>{member.name}</p>
            <div className="lab-heatmap">
              {chart.days!.map((day) => {
                const row = chart.rows.find((value) => value.id === `${member.id}:${day}`);
                return (
                  <button
                    key={day}
                    disabled={!row}
                    aria-label={`${member.name} ${day} ${row ? row[key] : 0} ${chart.unit}`}
                    style={{
                      background: row
                        ? `color-mix(in srgb,var(--brand,#0f766e) ${Math.max(12, (number(row, key) * 85) / maximum)}%,var(--surface,#fff))`
                        : undefined,
                    }}
                    onClick={() => row && onSelect(row)}
                  >
                    {Number(day.slice(-2))}
                    <small>{row ? String(row[key] ?? "") : ""}</small>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }
  const max = Math.max(
    1,
    ...chart.rows.map((row) => chart.series.reduce((sum, series) => sum + Math.abs(number(row, series.key)), 0))
  );
  return (
    <div>
      {chart.rows.map((row) => (
        <button key={row.id} className="lab-card-row" onClick={() => onSelect(row)}>
          <div className="lab-heading">
            <span>{row.label}</span>
            <small>{chart.series.map((series) => `${series.label} ${row[series.key] ?? "—"}`).join(" · ")}</small>
          </div>
          <div className="lab-bar lab-stack">
            {chart.series.map((series, index) => (
              <span
                key={series.key}
                style={{
                  width: `${(100 * Math.abs(number(row, series.key))) / max}%`,
                  background: colors[index % colors.length],
                }}
              />
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}
