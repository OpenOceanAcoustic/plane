import { PageHeading, useData, records, type Entity } from "../../components/ui";
import { DetailFields, ProjectPicker, ResultState } from "./shared";
import { userName, type CoreProps, type Member } from "./model";
export default function Overview(props: CoreProps) {
  if (!props.projectId)
    return (
      <>
        <PageHeading title="项目概览" />
        <ProjectPicker {...props} section="project-overview" />
      </>
    );
  return <ProjectOverview {...props} projectId={props.projectId} />;
}
function ProjectOverview({ client, workspaceSlug, projectId, onNavigate }: CoreProps & { projectId: string }) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}`;
  const project = useData<Entity>(client, `${base}/projects/${projectId}/`);
  const stats = useData<Entity[]>(client, `${base}/project-stats/?project_ids=${projectId}`);
  const members = useData<Member[]>(client, `${base}/projects/${projectId}/members/`);
  const row = records(stats.data)[0];
  return (
    <>
      <PageHeading title={String(project.data?.name ?? "项目概览")} />
      <ResultState loading={project.loading} error={project.error}>
        <p>{String(project.data?.description ?? "") || "暂无项目描述"}</p>
        <div className="core-overview">
          {[
            ["任务总数", "total_issues"],
            ["已完成任务", "completed_issues"],
            ["成员", "total_members"],
            ["周期", "total_cycles"],
            ["模块", "total_modules"],
          ].map(([name, key]) => (
            <div className="card" key={key}>
              <span className="muted">{name}</span>
              <strong>{String(row?.[key] ?? 0)}</strong>
            </div>
          ))}
        </div>
        <DetailFields
          values={[
            ["编号", String(project.data?.identifier ?? "")],
            ["可见性", project.data?.network === 2 ? "工作区公开" : "项目成员"],
            [
              "负责人",
              userName(members.data?.find((member) => member.member.id === project.data?.project_lead)?.member),
            ],
            ["状态", project.data?.archived_at ? "已归档" : "活跃"],
          ]}
        />
        <div className="core-tabs">
          {[
            ["任务", "tasks"],
            ["需求收件箱", "intake"],
            ["周期", "cycles"],
            ["模块", "modules"],
            ["视图", "views"],
            ["归档任务", "archived-tasks"],
            ["项目设置", "settings"],
          ].map(([name, page]) => (
            <button className="button" key={page} onClick={() => onNavigate({ page, projectId })}>
              {name}
            </button>
          ))}
        </div>
        <h2>项目成员</h2>
        <ResultState loading={members.loading} error={members.error}>
          <div className="list">
            {members.data?.map((member) => (
              <article className="card row" key={member.member.id}>
                <strong>{userName(member.member)}</strong>
                <span className="muted">{member.role >= 20 ? "管理员" : member.role >= 15 ? "成员" : "访客"}</span>
              </article>
            ))}
          </div>
        </ResultState>
        <ResultState loading={stats.loading} error={stats.error}>
          <span />
        </ResultState>
      </ResultState>
    </>
  );
}
