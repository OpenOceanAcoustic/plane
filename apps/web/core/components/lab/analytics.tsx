/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CalendarDays, Coins, Download, RefreshCw } from "lucide-react";
import { LabAnalyticsStore } from "@plane/shared-state";
import type { LabStore } from "@plane/shared-state";
import type { LabAnalyticsDomain, LabAnalyticsFilter, LabChart, LabChartDetails, LabChartRow } from "@plane/types";
import { Button, LabDialog, LabSelect, labInputClass } from "@plane/ui";
import { downloadLabExport, exportChartPng } from "./chart-export";
// oxlint-disable-next-line import/no-unassigned-import -- local financial and task surfaces
import "./finance-market.css";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
const DOMAINS = [
  { key: "project", label: "项目", Icon: BarChart3 },
  { key: "schedule", label: "排期", Icon: CalendarDays },
  { key: "vc", label: "VC", Icon: Coins },
] as const;

function shanghaiDay(date: Date) {
  const pieces = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (key: string) => pieces.find((piece) => piece.type === key)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function offsetDay(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return shanghaiDay(date);
}
function numeric(value: string | number | null | undefined) {
  return typeof value === "number" ? value : 0;
}
function display(value: string | number | null | undefined) {
  if (typeof value === "number") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  return value ?? "—";
}
function displayDate(rawValue: string | number) {
  const value = String(rawValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "short",
        timeStyle: "short",
        hour12: false,
      }).format(date)
    : value;
}
function chartRow(event: unknown): LabChartRow | undefined {
  if (!event || typeof event !== "object") return undefined;
  const payload = event as { payload?: LabChartRow; activePayload?: { payload: LabChartRow }[] };
  const row = payload.payload ?? payload.activePayload?.[0]?.payload;
  return row?.id ? row : undefined;
}

function Heatmap({ chart, onSelect }: { chart: LabChart; onSelect: (row: LabChartRow) => void }) {
  const days = chart.days ?? [];
  const members = chart.members ?? [];
  const byId = new Map(chart.rows.map((row) => [row.id, row]));
  const maximum = Math.max(1, ...chart.rows.map((row) => numeric(row.hours)));
  const width = Math.max(520, 112 + days.length * 40),
    height = Math.max(120, 42 + members.length * 34);
  return (
    <div className="overflow-auto" data-chart-canvas>
      <svg width={width} height={height} role="img" aria-label={chart.title}>
        {days.map((day, column) => (
          <text key={day} x={132 + column * 40} y={20} textAnchor="middle" fill="currentColor" fontSize={10}>
            {day.slice(5)}
          </text>
        ))}
        {members.map((member, index) => (
          <g key={member.id}>
            <text x={4} y={58 + index * 34} fill="currentColor" fontSize={12}>
              {member.name.slice(0, 9)}
            </text>
            {days.map((day, column) => {
              const row = byId.get(`${member.id}:${day}`);
              const hours = numeric(row?.hours);
              return (
                <g
                  key={day}
                  role={row ? "button" : undefined}
                  tabIndex={row ? 0 : undefined}
                  aria-label={`${member.name} ${day} ${display(hours)} 小时`}
                  className={row ? "cursor-pointer" : ""}
                  onClick={() => row && onSelect(row)}
                  onKeyDown={(event) => {
                    if (row && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onSelect(row);
                    }
                  }}
                >
                  <title>
                    {member.name} · {day} · {display(hours)} 小时
                  </title>
                  <rect
                    x={114 + column * 40}
                    y={38 + index * 34}
                    width={36}
                    height={28}
                    rx={4}
                    fill={hours ? COLORS[0] : "currentColor"}
                    opacity={hours ? 0.18 + (0.82 * hours) / maximum : 0.07}
                  />
                  <text x={132 + column * 40} y={57 + index * 34} textAnchor="middle" fill="currentColor" fontSize={10}>
                    {hours ? display(hours) : ""}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

function chartHasData(chart: LabChart) {
  return chart.rows.some((row) =>
    chart.id === "project-completion"
      ? numeric(row.total) > 0
      : chart.series.some((series) => numeric(row[series.key]) !== 0)
  );
}
function Plot({ chart, onSelect }: { chart: LabChart; onSelect: (row: LabChartRow) => void }) {
  if (!chartHasData(chart))
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg bg-layer-1 text-13 text-secondary">
        {chart.domain === "vc" && chart.id !== "vc-budget" && !chart.rows.length
          ? "选择项目查看贡献统计"
          : "所选范围暂无数据"}
      </div>
    );
  if (chart.kind === "heatmap") return <Heatmap chart={chart} onSelect={onSelect} />;
  const tooltipStyle = {
    backgroundColor: "var(--background-color-surface-1)",
    borderColor: "var(--border-color-subtle)",
    borderRadius: 8,
    color: "var(--text-color-primary)",
  };
  const tooltip = (
    <Tooltip
      contentStyle={tooltipStyle}
      formatter={(value: unknown, label: unknown) => [
        `${display(typeof value === "number" ? value : String(value))} ${chart.unit}`,
        String(label),
      ]}
    />
  );
  if (chart.kind === "donut")
    return (
      <div className="h-72" style={{ height: 288, minWidth: 0 }} data-chart-canvas>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chart.rows}
              dataKey={chart.series[0]!.key}
              nameKey="label"
              innerRadius="48%"
              outerRadius="72%"
              paddingAngle={3}
              isAnimationActive={false}
              onClick={(value: unknown) => {
                const row = chartRow(value);
                if (row) onSelect(row);
              }}
            >
              {chart.rows.map((row, index) => (
                <Cell key={row.id} fill={COLORS[index % COLORS.length]} cursor="pointer" />
              ))}
            </Pie>
            {tooltip}
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  if (chart.kind === "line")
    return (
      <div className="h-72" style={{ height: 288, minWidth: 0 }} data-chart-canvas>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chart.rows}
            margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
            onClick={(value: unknown) => {
              const row = chartRow(value);
              if (row) onSelect(row);
            }}
          >
            <CartesianGrid stroke="var(--border-color-subtle)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickFormatter={(label: string) => label.slice(5)}
              tick={{ fontSize: 11, fill: "var(--text-color-tertiary)" }}
              minTickGap={30}
            />
            <YAxis tick={{ fontSize: 11, fill: "var(--text-color-tertiary)" }} width={42} />
            {tooltip}
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {chart.series.map((series, index) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, cursor: "pointer" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  return (
    <div className="h-72" style={{ height: 288, minWidth: 0 }} data-chart-canvas>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart.rows} margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
          <CartesianGrid stroke="var(--border-color-subtle)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--text-color-tertiary)" }}
            tickFormatter={(label: string) => (label.length > 12 ? label.slice(0, 12) + "…" : label)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-color-tertiary)" }}
            width={42}
            domain={chart.unit === "%" ? [0, 100] : undefined}
          />
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {chart.series.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              fill={COLORS[index % COLORS.length]}
              stackId={chart.kind === "stack" ? "total" : undefined}
              radius={[3, 3, 0, 0]}
              maxBarSize={44}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(value: unknown) => {
                const row = chartRow(value);
                if (row) onSelect(row);
              }}
            >
              {chart.id === "project-completion" && (
                <LabelList
                  dataKey={series.key}
                  position="top"
                  formatter={(value: unknown) => `${display(typeof value === "number" ? value : 0)}%`}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartCard({
  chart,
  select,
  exportData,
  subtitle,
}: {
  chart: LabChart;
  select: (chart: LabChart, row: LabChartRow) => void;
  exportData: (chart: LabChart, format: "csv" | "json") => Promise<void>;
  subtitle: string;
}) {
  const container = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(callback: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await callback();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      ref={container}
      data-testid={`chart-${chart.id}`}
      data-tone={chart.domain === "vc" ? "purple" : chart.domain === "schedule" ? "indigo" : "emerald"}
      className="lab-analytics-card min-w-0 rounded-lg border border-subtle bg-layer-2 p-5"
    >
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-14 font-semibold">{chart.title}</h3>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={busy || !chartHasData(chart)}
          onClick={() =>
            void run(async () => {
              if (container.current) await exportChartPng(container.current, chart.title, subtitle);
            })
          }
        >
          PNG
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={busy}
          onClick={() => void run(() => exportData(chart, "csv"))}
        >
          CSV
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={busy}
          onClick={() => void run(() => exportData(chart, "json"))}
        >
          JSON
        </Button>
      </header>
      {chart.note && <p className="mb-3 min-h-8 text-12 text-secondary">{chart.note}</p>}
      {error && (
        <p role="alert" className="mb-2 text-12 text-danger-primary">
          {error}
        </p>
      )}
      <Plot chart={chart} onSelect={(row) => select(chart, row)} />
      <details className="mt-3 border-t border-subtle pt-3 text-12">
        <summary className="cursor-pointer text-secondary">数据与明细 · {chart.rows.length} 条</summary>
        <div className="mt-3 max-h-60 overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {chart.columns.map((column) => (
                  <th key={column.key} className="px-2 py-2 font-medium whitespace-nowrap">
                    {column.label}
                  </th>
                ))}
                <th className="px-2">明细</th>
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((row) => (
                <tr key={row.id} className="border-t border-subtle">
                  {chart.columns.map((column) => (
                    <td key={column.key} className="px-2 py-2">
                      {display(row[column.key])}
                    </td>
                  ))}
                  <td className="px-2">
                    <button className="whitespace-nowrap text-accent-primary" onClick={() => select(chart, row)}>
                      查看明细
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export const LabAnalyticsPanel = observer(function LabAnalyticsPanel({
  store,
  refreshKey = 0,
}: {
  store: LabStore;
  refreshKey?: number;
}) {
  const analytics = useMemo(() => new LabAnalyticsStore(store), [store]);
  const today = useMemo(() => shanghaiDay(new Date()), []);
  const [start, setStart] = useState(offsetDay(today, -29));
  const [end, setEnd] = useState(today);
  const [projectId, setProjectId] = useState("");
  const [userId, setUserId] = useState("");
  const [team, setTeam] = useState<boolean>();
  const [domain, setDomain] = useState<LabAnalyticsDomain | "all">("all");
  const [details, setDetails] = useState<{ chart: LabChart; key: string; data: LabChartDetails }>();
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState("");
  const filters = useMemo<LabAnalyticsFilter>(
    () => ({ start, end: end ? offsetDay(end, 1) : "", projectId, userId, team }),
    [start, end, projectId, userId, team]
  );
  const filtersKey = JSON.stringify(filters);
  const currentFiltersKey = useRef(filtersKey);
  currentFiltersKey.current = filtersKey;
  const detailRequests = useMemo(() => ({ serial: 0 }), []);
  const visibleData =
    analytics.loadedFilters && JSON.stringify(analytics.loadedFilters) === filtersKey ? analytics.data : undefined;
  useEffect(() => {
    if (start && end && start <= end) void analytics.load(filters);
  }, [analytics, filters, start, end, refreshKey]);
  useEffect(() => {
    ++detailRequests.serial;
    setDetails(undefined);
    setDetailBusy(false);
    setError("");
    return () => {
      ++detailRequests.serial;
    };
  }, [filtersKey, refreshKey, detailRequests]);
  async function showDetails(chart: LabChart, row: LabChartRow) {
    if (!visibleData || analytics.busy) return;
    const serial = ++detailRequests.serial;
    const scopeKey = filtersKey;
    setDetailBusy(true);
    setError("");
    try {
      const data = await analytics.details(filters, chart.id, row.id);
      if (serial === detailRequests.serial && scopeKey === currentFiltersKey.current)
        setDetails({ chart, key: row.id, data });
    } catch (failure) {
      if (serial === detailRequests.serial && scopeKey === currentFiltersKey.current)
        setError(failure instanceof Error ? failure.message : "明细加载失败");
    } finally {
      if (serial === detailRequests.serial && scopeKey === currentFiltersKey.current) setDetailBusy(false);
    }
  }
  async function exportData(chart: LabChart, format: "csv" | "json") {
    if (!visibleData || analytics.busy) throw new Error("请等待当前筛选加载完成");
    await downloadLabExport(analytics.exportUrl(filters, format, chart.id), `${chart.title}.${format}`);
  }
  function preset(days: number) {
    setStart(offsetDay(today, -(days - 1)));
    setEnd(today);
  }
  return (
    <section className="lab-analytics space-y-5" aria-label="实验室数据总览">
      <div className="lab-analytics-filters flex flex-wrap items-end gap-3 rounded-lg border border-subtle bg-layer-1 p-4">
        <label className="text-12 text-secondary">
          开始日期
          <input
            type="date"
            aria-label="统计开始日期"
            value={start}
            max={end}
            onChange={(event) => setStart(event.target.value)}
            className={`${labInputClass} mt-1`}
          />
        </label>
        <label className="text-12 text-secondary">
          结束日期
          <input
            type="date"
            aria-label="统计结束日期"
            value={end}
            min={start}
            onChange={(event) => setEnd(event.target.value)}
            className={`${labInputClass} mt-1`}
          />
        </label>
        <LabSelect
          label="统计项目"
          value={projectId || "all"}
          options={[
            { value: "all", label: "所有可访问项目" },
            ...analytics.projects.map((project) => ({ value: project.id, label: project.name })),
          ]}
          onValueChange={(value) => setProjectId(value === "all" ? "" : value)}
        />
        <LabSelect
          label="统计人员"
          value={userId || "all"}
          options={[
            { value: "all", label: "所有可见人员" },
            ...analytics.members.map((member) => ({ value: member.id, label: member.name })),
          ]}
          onValueChange={(value) => setUserId(value === "all" ? "" : value)}
        />
        {analytics.canViewTeam && (
          <LabSelect
            label="排期统计范围"
            value={(team ?? analytics.team) ? "team" : "personal"}
            options={[
              { value: "team", label: "团队排期" },
              { value: "personal", label: "本人排期" },
            ]}
            onValueChange={(value) => {
              setTeam(value === "team");
              setUserId("");
            }}
          />
        )}
        <Button variant="neutral-primary" size="sm" onClick={() => preset(7)}>
          近七天
        </Button>
        <Button variant="neutral-primary" size="sm" onClick={() => preset(30)}>
          近三十天
        </Button>
        <Button
          variant="neutral-primary"
          size="sm"
          loading={analytics.busy}
          onClick={() => void analytics.load(filters)}
        >
          <RefreshCw size={14} /> 刷新
        </Button>
      </div>
      <div className="lab-analytics-tabs flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={domain === "all" ? "accent-primary" : "neutral-primary"}
          aria-pressed={domain === "all"}
          onClick={() => setDomain("all")}
        >
          全部图表
        </Button>
        {DOMAINS.map(({ key, label, Icon }) => (
          <Button
            key={key}
            size="sm"
            variant={domain === key ? "accent-primary" : "neutral-primary"}
            aria-pressed={domain === key}
            onClick={() => setDomain(key)}
          >
            <Icon size={14} />
            {label}
          </Button>
        ))}
        {visibleData && !analytics.busy && (
          <>
            <a
              className="ml-auto flex items-center gap-1 text-12 text-accent-primary"
              href={analytics.exportUrl(filters, "csv")}
            >
              <Download size={14} />
              全部 CSV
            </a>
            <a
              className="text-12 text-accent-primary"
              href={analytics.exportUrl(filters, "json")}
              target="_blank"
              rel="noreferrer"
            >
              JSON
            </a>
          </>
        )}
      </div>
      {(analytics.error || error) && (
        <p role="alert" className="rounded-md border border-danger-subtle p-3 text-13 text-danger-primary">
          {analytics.error || error}
        </p>
      )}
      {detailBusy && (
        <p role="status" className="text-13 text-secondary">
          正在读取明细…
        </p>
      )}
      {!visibleData && analytics.busy && (
        <div role="status" className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-80 animate-pulse rounded-xl bg-layer-1" />
          ))}
        </div>
      )}
      {visibleData && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {visibleData.charts
            .filter((entry) => domain === "all" || entry.domain === domain)
            .map((entry) => (
              <ChartCard
                key={entry.id}
                chart={entry}
                select={(chart, row) => void showDetails(chart, row)}
                exportData={exportData}
                subtitle={`${start} 至 ${end} · Asia/Shanghai`}
              />
            ))}
        </div>
      )}
      {details && (
        <LabDialog
          title={`${details.chart.title} · 明细`}
          busy={detailBusy}
          submitLabel="导出明细 CSV"
          onClose={() => setDetails(undefined)}
          onSubmit={() =>
            downloadLabExport(
              analytics.exportUrl(filters, "csv", details.chart.id, details.key),
              `${details.chart.title}-明细.csv`
            )
          }
        >
          <p className="text-12 text-secondary">共 {details.data.records.length} 条</p>
          <div className="max-h-96 overflow-auto">
            {details.data.records.length ? (
              <ul className="divide-y divide-subtle">
                {details.data.records.map((record, index) => (
                  // These immutable server rows have no public identifier when private time is hidden.
                  // oxlint-disable-next-line react/no-array-index-key
                  <li key={index} className="space-y-1 py-3">
                    {record.url ? (
                      <a className="text-13 font-medium text-accent-primary" href={record.url}>
                        {record.title}
                      </a>
                    ) : (
                      <p className="text-13 font-medium">{record.title}</p>
                    )}
                    <p className="text-12 text-secondary">
                      {[record.project, record.person, record.status].filter(Boolean).join(" · ")} ·{" "}
                      {display(record.value)}
                    </p>
                    {record.start && (
                      <p className="text-12 text-tertiary">
                        {displayDate(record.start)}
                        {record.end ? ` → ${displayDate(record.end)}` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-13 text-secondary">此项暂无明细记录</p>
            )}
          </div>
        </LabDialog>
      )}
    </section>
  );
});
