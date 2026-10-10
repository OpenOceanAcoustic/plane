import { useMemo, useState } from "react";
import { CanonicalIcon } from "../../components/navigation";
import { ActionButton, Html, PageHeading, useData, records, type Entity } from "../../components/ui";
import { ProjectPicker, ResultState } from "./shared";
import { CoreService, userName, type CoreProps, type Member } from "./model";
import { RichHtmlEditor } from "../../components/rich-editor";
import { plainText, safeTextHtml } from "./model";
import { TaskForm } from "./tasks";
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
  const service = useMemo(() => new CoreService(client, workspaceSlug, projectId), [client, workspaceSlug, projectId]);
  const project = useData<Entity>(client, `${base}/projects/${projectId}/`);
  const stats = useData<Entity[]>(client, `${base}/project-stats/?project_ids=${projectId}`);
  const members = useData<Member[]>(client, `${base}/projects/${projectId}/members/`);
  const states = useData<Entity[]>(client, `${service.projectPath}/states/`);
  const labels = useData<Entity[]>(client, `${service.projectPath}/issue-labels/`);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState<string>();
  const workspace = useData<Entity>(client, `${base}/`);
  const canEditDescription =
    !project.data?.archived_at && (Number(project.data?.member_role) >= 20 || Number(workspace.data?.role) >= 20);
  const originalDescription = String(
    project.data?.description_html || safeTextHtml(String(project.data?.description || "暂无项目描述"))
  );
  const row = records(stats.data)[0];
  const lead = members.data?.find((member) => member.member.id === project.data?.project_lead)?.member;
  const count = (key: string) => (stats.loading || stats.error || !row ? "—" : String(row[key] ?? 0));
  const links = [
    ["任务", "tasks", count("total_issues")],
    ["周期", "cycles", count("total_cycles")],
    ["模块", "modules", count("total_modules")],
    ["视图", "views", ""],
    ["项目文档", "documents", ""],
    ["需求收集", "intake", ""],
    ["归档", "archived-tasks", ""],
    ["项目设置", "project-settings", ""],
  ];
  return (
    <>
      <PageHeading title={String(project.data?.name ?? "项目概览")} />
      {Number(project.data?.member_role) >= 15 && (
        <div className="core-overview-actions">
          <button className="button primary" onClick={() => setCreating(true)}>
            添加任务
          </button>
        </div>
      )}
      <ResultState loading={project.loading} error={project.error}>
        <div className="core-project-hero">
          <span>
            {String(project.data?.identifier ?? "")} · {project.data?.network === 2 ? "公开项目" : "私有项目"}
          </span>
          <h1>{String(project.data?.name ?? "")}</h1>
          <p>
            {lead ? `${userName(lead)} · ` : ""}
            {members.data ? `${members.data.length}名成员` : "—"}
          </p>
          {Boolean(project.data?.is_favorite) && <span className="core-pill">已收藏</span>}
        </div>
        <div className="core-project-description-editor">
          {canEditDescription ? (
            <RichHtmlEditor
              compact
              heading="项目描述"
              value={description ?? originalDescription}
              onChange={setDescription}
            />
          ) : (
            <div className="core-readonly-description">
              <h3>项目描述</h3>
              <Html html={originalDescription} />
            </div>
          )}
          {description !== undefined && description !== originalDescription && (
            <ActionButton
              className="button primary"
              action={() =>
                client.request(`${base}/projects/${projectId}/`, "PATCH", {
                  description_html: description,
                  description: plainText(description),
                })
              }
              onDone={() => {
                setDescription(undefined);
                void project.refresh();
              }}
            >
              保存描述
            </ActionButton>
          )}
        </div>
        <div className="core-rows core-property-rows">
          {links.map(([name, page, value]) => (
            <button className="row" key={page} onClick={() => onNavigate({ page, projectId })}>
              <span className="row-main">{name}</span>
              <span className="row-value">{value}</span>
              <CanonicalIcon name="arrow" size={16} />
            </button>
          ))}
        </div>
        <div className="core-section-heading">
          <h2>项目成员</h2>
        </div>
        <ResultState loading={members.loading} error={members.error}>
          <div className="core-rows">
            {members.data?.map((member) => (
              <div className="row" key={member.member.id}>
                <span className="row-main">{userName(member.member)}</span>
                <span className="row-value">
                  {member.member.id === project.data?.project_lead
                    ? "负责人"
                    : member.role >= 20
                      ? "管理员"
                      : member.role >= 15
                        ? "成员"
                        : "访客"}
                </span>
              </div>
            ))}
          </div>
        </ResultState>
        <button className="button primary" onClick={() => onNavigate({ page: "tasks", projectId })}>
          打开任务
        </button>
        <ResultState loading={stats.loading} error={stats.error}>
          <span />
        </ResultState>
      </ResultState>
      {creating && (
        <TaskForm
          service={service}
          states={records(states.data)}
          members={members.data}
          labels={records(labels.data)}
          onClose={() => setCreating(false)}
          onDone={async (task, again) => {
            await stats.refresh();
            if (!again) onNavigate({ page: "issue", projectId, issueId: task.id });
          }}
        />
      )}
    </>
  );
}
