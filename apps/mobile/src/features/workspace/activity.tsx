import { MobileSelect } from "../../components/select";
import { PageHeading } from "../../components/ui";
import { useState } from "react";
import { records, useData, type Entity } from "../../components/ui";
import { LabField, labInputClass } from "../lab/ui";
import { type Page, type WorkspaceProps } from "./business";
import { Pagination, Status, useWorkspace } from "./shared";
const activityNames: Record<string, string> = {
  created: "创建",
  updated: "更新",
  deleted: "删除",
  archived: "归档",
  restored: "恢复",
};
const fieldNames: Record<string, string> = {
  name: "名称",
  priority: "优先级",
  state: "状态",
  assignees: "负责人",
  labels: "标签",
  start_date: "开始日期",
  target_date: "截止日期",
  description: "描述",
  parent: "父任务",
  module: "模块",
  cycle: "周期",
};
export default function Activity(props: WorkspaceProps) {
  const { base, session, projects } = useWorkspace(props),
    [project, setProject] = useState(""),
    [cursor, setCursor] = useState("");
  const result = useData<Page<Entity>>(
    props.client,
    session.data?.user.id
      ? `${base}/user-activity/${session.data.user.id}/?per_page=30${project ? `&project=${encodeURIComponent(project)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      : null
  );
  const rows = records(result.data);
  return (
    <>
      <PageHeading title="我的活动" />
      <LabField label="项目筛选">
        <MobileSelect
          className={labInputClass}
          value={project}
          onChange={(event) => {
            setProject(event.target.value);
            setCursor("");
          }}
        >
          <option value="">全部项目</option>
          {projects.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </MobileSelect>
      </LabField>
      <Status loading={session.loading || result.loading} error={session.error ?? result.error} empty={!rows.length} />
      <div className="lab-list">
        {rows.map((activity) => {
          const issue = activity.issue_detail as Entity | undefined,
            projectDetail = activity.project_detail as Entity | undefined;
          return (
            <article key={String(activity.id)} className="lab-card">
              <p className="lab-muted">
                {activity.created_at ? new Date(String(activity.created_at)).toLocaleString("zh-CN") : ""}
              </p>
              {issue?.id ? (
                <button
                  className="record-title"
                  onClick={() =>
                    props.onNavigate({
                      page: "issue",
                      projectId: String(activity.project ?? issue.project_id ?? projectDetail?.id),
                      issueId: String(issue.id),
                    })
                  }
                >
                  {String(issue.name ?? "任务")}
                </button>
              ) : (
                <h2>{String(activity.comment ?? "工作区活动")}</h2>
              )}
              <p>
                {activityNames[String(activity.verb)] ?? String(activity.verb ?? "")}{" "}
                {fieldNames[String(activity.field)] ?? String(activity.field ?? "")}
              </p>
              {activity.old_value !== null && activity.old_value !== undefined && (
                <p className="lab-muted">原值：{String(activity.old_value)}</p>
              )}
              {activity.new_value !== null && activity.new_value !== undefined && (
                <p>新值：{String(activity.new_value)}</p>
              )}
              <p className="lab-muted">{String(projectDetail?.name ?? "")}</p>
            </article>
          );
        })}
      </div>
      <Pagination page={result.data} onChange={setCursor} />
    </>
  );
}
