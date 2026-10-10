import { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CanonicalIcon, MobileHeaderContext } from "../../components/navigation";
// oxlint-disable-next-line import/no-unassigned-import -- live V6 component adapters
import "./v6.css";
import { ActionButton, Html, PageHeading, Sheet, useData, records, type Entity } from "../../components/ui";
import { ProjectPicker, ResultState } from "./shared";
import { CoreService, userName, type CoreProps } from "./model";
import { RichHtmlEditor } from "../../components/rich-editor";
import { plainText, safeTextHtml } from "./model";
import { useProjectMembers } from "./members";
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
  const members = useProjectMembers(client, workspaceSlug, projectId);
  const states = useData<Entity[]>(client, `${service.projectPath}/states/`);
  const labels = useData<Entity[]>(client, `${service.projectPath}/issue-labels/`);
  const [creating, setCreating] = useState(false);
  const [panel, setPanel] = useState<"description" | "more" | null>(null);
  const header = useContext(MobileHeaderContext);
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
      <PageHeading title="项目概览" onBack={() => onNavigate({ page: "projects" })}>
        <button className="m3-icon-button px-icon-button" aria-label="项目更多操作" onClick={() => setPanel("more")}>
          <CanonicalIcon name="more" size={22} />
        </button>
      </PageHeading>
      <ResultState loading={project.loading} error={project.error}>
        <main className="px-body px-overview">
          <div className="px-project-heading">
            <div>
              <div className="px-project-code">{String(project.data?.identifier ?? "")}</div>
              <h1>{String(project.data?.name ?? "")}</h1>
            </div>
            <div className="px-project-symbol">
              <CanonicalIcon name="ocean" size={29} />
            </div>
          </div>
          <div className="px-project-meta">
            <span>
              <CanonicalIcon name="lock" size={14} />
              {project.data?.network === 2 ? "公开项目" : "私有项目"}
            </span>
            <span>
              <CanonicalIcon name="users" size={16} />
              {members.data?.length ?? "—"} 名成员
            </span>
          </div>
          <div className="px-project-owner">
            <span className="px-avatar">{lead ? userName(lead).slice(0, 1) : "—"}</span>
            <span>{lead ? userName(lead) : "未设置负责人"}</span>
          </div>
          <section className="px-summary-panel">
            <div className="px-section-heading">
              <h2>项目描述</h2>
              {canEditDescription && (
                <button
                  className="m3-icon-button px-icon-button"
                  aria-label="编辑项目描述"
                  onClick={() => setPanel("description")}
                >
                  <CanonicalIcon name="edit" size={19} />
                </button>
              )}
            </div>
            <div className="v6-project-description">
              <Html html={originalDescription} />
            </div>
            <div className="px-stats">
              {links.slice(0, 3).map(([name, page, value]) => (
                <button key={page} onClick={() => onNavigate({ page, projectId })}>
                  <strong>{value}</strong>
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="px-links" aria-label="项目内容">
            {(
              [
                ["任务", "tasks", "list"],
                ["视图", "views", "board"],
                ["项目文档", "documents", "files"],
              ] as const
            ).map(([name, page, icon]) => (
              <button key={page} onClick={() => onNavigate({ page, projectId })}>
                <span className="px-link-icon">
                  <CanonicalIcon name={icon} size={page === "tasks" ? 20 : 21} />
                </span>
                <span>{name}</span>
                <CanonicalIcon name="chevron" size={19} />
              </button>
            ))}
          </section>
          <ResultState loading={stats.loading} error={stats.error}>
            <span />
          </ResultState>
        </main>
      </ResultState>
      {Number(project.data?.member_role) >= 15 &&
        !project.data?.archived_at &&
        (header?.fab ? (
          createPortal(
            <button className="m3-fab px-fab" onClick={() => setCreating(true)}>
              <CanonicalIcon name="plus" size={23} />
              添加任务
            </button>,
            header.fab
          )
        ) : (
          <button className="m3-fab px-fab" onClick={() => setCreating(true)}>
            <CanonicalIcon name="plus" size={23} />
            添加任务
          </button>
        ))}
      {panel === "description" && (
        <Sheet title="项目描述" onClose={() => setPanel(null)}>
          <RichHtmlEditor
            compact
            heading="项目描述"
            value={description ?? originalDescription}
            onChange={setDescription}
          />
          <ActionButton
            className="button primary"
            action={() =>
              client.request(`${base}/projects/${projectId}/`, "PATCH", {
                description_html: description ?? originalDescription,
                description: plainText(description ?? originalDescription),
              })
            }
            onDone={() => {
              setDescription(undefined);
              setPanel(null);
              void project.refresh();
            }}
          >
            保存描述
          </ActionButton>
        </Sheet>
      )}
      {panel === "more" && (
        <Sheet title="项目更多操作" onClose={() => setPanel(null)}>
          <div className="core-rows">
            {links.map(([name, page, value]) => (
              <button
                className="row"
                key={page}
                onClick={() => {
                  setPanel(null);
                  onNavigate({ page, projectId });
                }}
              >
                <span className="row-main">{name}</span>
                <span className="row-value">{value}</span>
                <CanonicalIcon name="chevron" size={16} />
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
        </Sheet>
      )}
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
