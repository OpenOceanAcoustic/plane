import { PageHeading } from "../../components/ui";
import { useState } from "react";
import { useData, records, type Entity } from "../../components/ui";
import { Button, LabDialog, LabField, labInputClass } from "../lab/ui";
import { groupNames, priorityName } from "../core/model";
import { viewQuery, type Page, type WorkspaceProps } from "./business";
import { Pagination, Status, TaskRows, useWorkspace } from "./shared";
type ChartRow = Entity & { key: string; name: string; count: number };
type Chart = { data: ChartRow[]; schema: Record<string, string> };
const axes = [
  { key: "PRIORITY", name: "优先级", filter: "priority" },
  { key: "STATE_GROUPS", name: "状态组", filter: "state_group" },
  { key: "STATES", name: "状态", filter: "state" },
  { key: "ASSIGNEES", name: "负责人", filter: "assignees" },
  { key: "LABELS", name: "标签", filter: "labels" },
  { key: "CYCLES", name: "周期", filter: "cycle" },
  { key: "MODULES", name: "模块", filter: "module" },
];
const statNames: Record<string, string> = {
  total_users: "成员",
  total_admins: "管理员",
  total_members: "普通成员",
  total_guests: "访客",
  total_projects: "项目",
  total_work_items: "任务",
  total_cycles: "周期",
  total_intake: "收件箱",
  started_work_items: "进行中",
  backlog_work_items: "待办",
  un_started_work_items: "未开始",
  completed_work_items: "已完成",
  cancelled_work_items: "已取消",
};
const projectTypeNames: Record<string, string> = {
  work_items: "任务",
  cycles: "周期",
  modules: "模块",
  intake: "收件箱",
  members: "成员",
  pages: "文档",
  views: "视图",
};
function createdRange(duration: string): string[] {
  const today = new Date(),
    end = today.toLocaleDateString("en-CA"),
    days = duration === "last_7_days" ? 7 : duration === "last_30_days" ? 30 : duration === "last_3_months" ? 90 : 0;
  if (!days) return [];
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  return [`${start.toLocaleDateString("en-CA")};after`, `${end};before`];
}
export default function WorkspaceAnalytics(props: WorkspaceProps) {
  const { base, role, membership, projects } = useWorkspace(props),
    [tab, setTab] = useState("overview"),
    [project, setProject] = useState(""),
    [duration, setDuration] = useState("last_30_days"),
    [axis, setAxis] = useState("PRIORITY"),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState<ChartRow>(),
    [cursor, setCursor] = useState("");
  const query = new URLSearchParams({ date_filter: duration });
  if (project) query.set("project_ids", project);
  const summary = useData<Record<string, { count: number }>>(
    props.client,
    role >= 15 ? `${base}/advance-analytics/?tab=${tab}&${query}` : null
  );
  const stats = useData<Entity[]>(
    props.client,
    role >= 15 && tab === "work-items" ? `${base}/advance-analytics-stats/?type=work-items&${query}` : null
  );
  const composition = useData<ChartRow[]>(
    props.client,
    role >= 15 && tab === "overview" ? `${base}/advance-analytics-charts/?type=projects&${query}` : null
  );
  const trends = useData<Chart>(
    props.client,
    role >= 15 ? `${base}/advance-analytics-charts/?type=work-items&${query}` : null
  );
  const custom = useData<Chart>(
    props.client,
    role >= 15 && tab === "work-items"
      ? `${base}/advance-analytics-charts/?type=custom-work-items&x_axis=${axis}${group ? `&group_by=${group}` : ""}&${query}`
      : null
  );
  const selectedAxis = axes.find((item) => item.key === axis)!;
  const filters: Record<string, unknown> = {
    sub_issue: "true",
    project: project ? [project] : [],
    created_at: createdRange(duration),
  };
  if (selected)
    filters[selectedAxis.filter] = [selected.key === "None" || selected.key === "none" ? "None" : selected.key];
  const details = useData<Page<Entity>>(
    props.client,
    selected ? `${base}/issues/?${viewQuery(filters, cursor)}` : null
  );
  const label = (row: ChartRow) =>
    axis === "PRIORITY"
      ? priorityName(row.key)
      : axis === "STATE_GROUPS"
        ? (groupNames[row.key] ?? row.name)
        : row.name;
  if (!membership.loading && role < 15)
    return (
      <>
        <PageHeading title="工作区统计" />
        <p className="lab-muted">无权访问</p>
        <Status error={membership.error} />
      </>
    );
  return (
    <>
      <PageHeading title="工作区统计" />
      <div className="lab-tabs">
        <Button
          variant={tab === "overview" ? "primary" : ""}
          onClick={() => {
            setTab("overview");
            setSelected(undefined);
          }}
        >
          概览
        </Button>
        <Button variant={tab === "work-items" ? "primary" : ""} onClick={() => setTab("work-items")}>
          任务分析
        </Button>
      </div>
      <LabField label="项目筛选">
        <select
          className={labInputClass}
          value={project}
          onChange={(event) => {
            setProject(event.target.value);
            setSelected(undefined);
          }}
        >
          <option value="">全部项目</option>
          {projects.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </LabField>
      <LabField label="日期范围">
        <select
          className={labInputClass}
          value={duration}
          onChange={(event) => {
            setDuration(event.target.value);
            setSelected(undefined);
          }}
        >
          <option value="">全部时间</option>
          <option value="last_7_days">最近 7 天</option>
          <option value="last_30_days">最近 30 天</option>
          <option value="last_3_months">最近 3 个月</option>
        </select>
      </LabField>
      <Status loading={membership.loading || summary.loading} error={summary.error} />
      <div className="workspace-stat-grid">
        {Object.entries(summary.data ?? {}).map(([key, value]) => (
          <article className="lab-card" key={key}>
            <strong>{value.count}</strong>
            <p>{statNames[key] ?? key}</p>
          </article>
        ))}
      </div>
      {tab === "overview" && (
        <section className="lab-card">
          <h2>工作区内容</h2>
          <Status loading={composition.loading} error={composition.error} empty={!composition.data?.length} />
          <Bars
            rows={(composition.data ?? []).map((row) =>
              Object.assign({}, row, { name: projectTypeNames[row.key] ?? row.name })
            )}
          />
        </section>
      )}
      <section className="lab-card">
        <h2>任务创建与完成</h2>
        <Status loading={trends.loading} error={trends.error} empty={!trends.data?.data?.length} />
        {trends.data?.data && <Trend rows={trends.data.data} />}
      </section>
      {tab === "work-items" && (
        <>
          <section className="lab-card">
            <h2>任务分布</h2>
            <LabField label="分析维度">
              <select
                className={labInputClass}
                value={axis}
                onChange={(event) => {
                  setAxis(event.target.value);
                  setSelected(undefined);
                }}
              >
                {axes.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name}
                  </option>
                ))}
              </select>
            </LabField>
            <LabField label="分组">
              <select className={labInputClass} value={group} onChange={(event) => setGroup(event.target.value)}>
                <option value="">不分组</option>
                {axes
                  .filter((item) => item.key !== axis)
                  .map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </LabField>
            <Status loading={custom.loading} error={custom.error} empty={!custom.data?.data?.length} />
            <Bars
              rows={(custom.data?.data ?? []).map((row) => Object.assign({}, row, { name: label(row) }))}
              schema={custom.data?.schema}
              onSelect={(row) => {
                setSelected(row);
                setCursor("");
              }}
            />
          </section>
          <h2>项目累计任务明细</h2>
          <Status loading={stats.loading} error={stats.error} empty={!stats.data?.length} />
          <div className="lab-list">
            {stats.data?.map((row) => (
              <article className="lab-card" key={String(row.project_id)}>
                <button
                  className="record-title"
                  onClick={() => props.onNavigate({ page: "tasks", projectId: String(row.project_id) })}
                >
                  {String(row.project__name)}
                </button>
                <dl className="lab-values">
                  {Object.keys(statNames)
                    .filter((key) => key in row)
                    .map((key) => (
                      <div key={key}>
                        <dt>{statNames[key]}</dt>
                        <dd>{Number(row[key])}</dd>
                      </div>
                    ))}
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
      {selected && (
        <LabDialog title={`${selectedAxis.name}：${label(selected)}`} onClose={() => setSelected(undefined)}>
          <Status loading={details.loading} error={details.error} empty={!records(details.data).length} />
          <TaskRows rows={records(details.data)} onNavigate={props.onNavigate} />
          <Pagination page={details.data} onChange={setCursor} />
        </LabDialog>
      )}
    </>
  );
}
function Bars({
  rows,
  schema = {},
  onSelect,
}: {
  rows: ChartRow[];
  schema?: Record<string, string>;
  onSelect?: (row: ChartRow) => void;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.count)),
    colors = ["#3b8870", "#3274ad", "#ad7840", "#8063a8", "#bc4b51"];
  return (
    <div>
      {rows.map((row) => {
        const content = (
          <>
            <div className="lab-heading">
              <span>{row.name}</span>
              <strong>{row.count}</strong>
            </div>
            <div className="lab-bar lab-stack">
              {Object.keys(schema).length ? (
                Object.keys(schema).map((key, index) => (
                  <span
                    key={key}
                    style={{
                      width: `${(100 * (Number(row[key]) || 0)) / maximum}%`,
                      background: colors[index % colors.length],
                    }}
                  />
                ))
              ) : (
                <span style={{ width: `${(100 * row.count) / maximum}%`, background: colors[0] }} />
              )}
            </div>
            {Object.entries(schema).length > 0 && (
              <p className="lab-muted">
                {Object.entries(schema)
                  .map(([key, name]) => `${name}: ${Number(row[key]) || 0}`)
                  .join(" · ")}
              </p>
            )}
          </>
        );
        return onSelect ? (
          <button className="lab-card-row" key={row.key} onClick={() => onSelect(row)}>
            {content}
          </button>
        ) : (
          <div className="lab-card-row" key={row.key}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
function Trend({ rows }: { rows: ChartRow[] }) {
  const maximum = Math.max(
    1,
    ...rows.flatMap((row) => [Number(row.created_issues) || 0, Number(row.completed_issues) || 0])
  );
  const point = (index: number, value: number) =>
    `${12 + (index * 296) / Math.max(1, rows.length - 1)},${130 - (value * 115) / maximum}`;
  return (
    <>
      <svg className="lab-chart-svg" viewBox="0 0 320 160" role="img" aria-label="任务创建与完成月度趋势">
        <polyline
          fill="none"
          stroke="#3274ad"
          strokeWidth="3"
          points={rows.map((row, index) => point(index, Number(row.created_issues) || 0)).join(" ")}
        />
        <polyline
          fill="none"
          stroke="#3b8870"
          strokeWidth="3"
          points={rows.map((row, index) => point(index, Number(row.completed_issues) || 0)).join(" ")}
        />
        <text x="12" y="155" fill="currentColor" fontSize="11">
          {rows[0]?.name.slice(0, 7)}
        </text>
        <text x="308" y="155" textAnchor="end" fill="currentColor" fontSize="11">
          {rows.at(-1)?.name.slice(0, 7)}
        </text>
      </svg>
      <p className="lab-muted">蓝色：创建任务 · 绿色：已完成任务</p>
      <details>
        <summary>查看趋势数据</summary>
        {rows.map((row) => (
          <p key={row.key}>
            {row.name.slice(0, 7)}：创建 {Number(row.created_issues) || 0} · 完成 {Number(row.completed_issues) || 0}
          </p>
        ))}
      </details>
    </>
  );
}
