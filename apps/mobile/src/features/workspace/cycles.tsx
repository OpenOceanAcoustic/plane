import { useState } from "react";
import { records, useData, type Entity } from "../../components/ui";
import { Button, LabField, labInputClass } from "../lab/ui";
import { activeCycle, type Page, type WorkspaceProps } from "./business";
import { Pagination, Status, TaskRows, useWorkspace, useDetailBack } from "./shared";
export default function ActiveCycles(props: WorkspaceProps) {
  const { base, projects, role } = useWorkspace(props),
    cycles = useData<Entity[]>(props.client, `${base}/cycles/`),
    [project, setProject] = useState(""),
    [selected, setSelected] = useState<Entity>(),
    [cursor, setCursor] = useState("");
  const rows = (cycles.data ?? []).filter((cycle) => activeCycle(cycle) && (!project || cycle.project_id === project));
  useDetailBack(!!selected, () => {
    setSelected(undefined);
    setCursor("");
  });
  const tasks = useData<Page<Entity>>(
    props.client,
    selected && role >= 15
      ? `${base}/projects/${selected.project_id}/cycles/${selected.id}/cycle-issues/?per_page=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      : null
  );
  return (
    <>
      <div className="lab-heading">
        <h1>{selected ? String(selected.name) : "活跃周期"}</h1>
        {selected && <Button onClick={() => setSelected(undefined)}>返回</Button>}
      </div>
      {selected ? (
        <>
          <p>{String(selected.description ?? "")}</p>
          <CycleProgress cycle={selected} />
          <Status loading={tasks.loading} error={tasks.error} empty={role >= 15 && !records(tasks.data).length} />
          {role < 15 && <p className="lab-muted">周期任务列表向项目成员开放。</p>}
          <TaskRows
            rows={records(tasks.data).map((row) => {
              const issue = row.issue_detail as Entity | undefined;
              return Object.assign({}, issue ?? row, { project_id: selected.project_id });
            })}
            onNavigate={props.onNavigate}
          />
          <Pagination page={tasks.data} onChange={setCursor} />
          <Button onClick={() => props.onNavigate({ page: "cycles", projectId: String(selected.project_id) })}>
            管理项目周期
          </Button>
        </>
      ) : (
        <>
          <LabField label="项目筛选">
            <select className={labInputClass} value={project} onChange={(event) => setProject(event.target.value)}>
              <option value="">全部项目</option>
              {projects.data?.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          <Status loading={cycles.loading} error={cycles.error} empty={!rows.length} />
          <div className="lab-list">
            {rows.map((cycle) => (
              <article className="lab-card" key={String(cycle.id)}>
                <button
                  className="record-title"
                  onClick={() => {
                    setSelected(cycle);
                    setCursor("");
                  }}
                >
                  {String(cycle.name)}
                </button>
                <p className="lab-muted">
                  {projects.data?.find((row) => row.id === cycle.project_id)?.name} ·{" "}
                  {String(cycle.start_date).slice(0, 10)} — {String(cycle.end_date).slice(0, 10)}
                </p>
                <CycleProgress cycle={cycle} />
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
function CycleProgress({ cycle }: { cycle: Entity }) {
  const total = Number(cycle.total_issues) || 0,
    done = Number(cycle.completed_issues) || 0;
  return (
    <>
      <progress aria-label="周期完成进度" max={Math.max(1, total)} value={done} />
      <p>
        完成 {done} / {total} · 进行中 {Number(cycle.started_issues) || 0} · 未开始{" "}
        {Number(cycle.unstarted_issues) || 0} · 待办 {Number(cycle.backlog_issues) || 0}
      </p>
    </>
  );
}
