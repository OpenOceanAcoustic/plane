import type { Entity } from "../../components/ui";
import { ErrorMessage, records, useData } from "../../components/ui";
import type { ApiClient } from "../../lib/client";
import { objectValue } from "./preferences";
import { dateLabel } from "./model";

export function CollectionStats({
  row,
  client,
  base,
  section,
}: {
  row: Entity;
  client: ApiClient;
  base: string;
  section: string;
}) {
  const analytics = useData<Entity>(
    client,
    section === "cycles" && row.start_date && row.end_date ? `${base}${row.id}/analytics/` : null
  );
  const distribution = analytics.data ?? objectValue(row.distribution);
  const chart = Object.entries(objectValue(distribution.completion_chart))
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022-compatible ordering of a new array
    .sort((a, b) => a[0].localeCompare(b[0]));
  const total = Number(row.total_issues ?? 0),
    completed = Number(row.completed_issues ?? 0);
  const maximum = Math.max(1, total, ...chart.map(([, value]) => value));
  return (
    <>
      <ErrorMessage error={analytics.error} />
      <section className="card">
        <h2>完成进度</h2>
        <p>
          {completed} / {total} 个任务
        </p>
        <progress aria-label="完成进度" max={Math.max(1, total)} value={completed} style={{ width: "100%" }} />
        {!!chart.length && (
          <>
            <h3>剩余任务趋势</h3>
            <svg
              viewBox="0 0 320 110"
              role="img"
              aria-label="剩余任务趋势"
              style={{ width: "100%", color: "var(--ink)" }}
            >
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                points={chart
                  .map(
                    ([, value], index) =>
                      `${10 + (index * 300) / Math.max(1, chart.length - 1)},${100 - (value * 90) / maximum}`
                  )
                  .join(" ")}
              />
            </svg>
            <p className="muted">
              {dateLabel(chart[0]?.[0])} — {dateLabel(chart[chart.length - 1]?.[0])}
            </p>
            <details>
              <summary>按日期查看</summary>
              {chart.map(([date, count]) => (
                <div className="row" key={date}>
                  <span>{date}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </details>
          </>
        )}
      </section>
      {(["assignees", "labels"] as const).map(
        (kind) =>
          records(distribution[kind]).length > 0 && (
            <section className="card" key={kind}>
              <h3>{kind === "assignees" ? "负责人分布" : "标签分布"}</h3>
              {records(distribution[kind]).map((item) => (
                <div className="row" key={String(item.assignee_id ?? item.label_id ?? "unassigned")}>
                  <span>
                    {String(
                      item.display_name ??
                        item.first_name ??
                        item.label_name ??
                        (kind === "assignees" ? "未分配" : "无标签")
                    )}
                  </span>
                  <span>
                    {Number(item.completed_issues ?? 0)} / {Number(item.total_issues ?? 0)}
                  </span>
                </div>
              ))}
            </section>
          )
      )}
    </>
  );
}
