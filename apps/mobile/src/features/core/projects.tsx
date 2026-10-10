import { useState } from "react";
import { Archive, ArrowRight, MoreHorizontal, Star } from "lucide-react";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  PageHeading,
  Sheet,
  records,
  useData,
  type Entity,
  type FormField,
} from "../../components/ui";
import { DetailFields, Empty, ResultState, AddButton } from "./shared";
import { userName, type Session, type Member, type CoreProps, type NamedEntity } from "./model";

function projectFields(project?: Entity, members: Member[] = []): FormField[] {
  return [
    { key: "name", label: "项目名称", value: project?.name, required: true },
    { key: "identifier", label: "项目标识", value: project?.identifier, required: true, placeholder: "例如 AUV" },
    { key: "description", label: "项目描述", type: "textarea", value: project?.description },
    {
      key: "network",
      label: "可见性",
      type: "select",
      value: project?.network ?? 0,
      options: [
        { value: "0", label: "私密项目" },
        { value: "2", label: "工作区公开" },
      ],
    },
    {
      key: "project_lead",
      label: "项目负责人",
      type: "select",
      value: project?.project_lead,
      options: members
        .filter((row) => row.role >= 15)
        .map((row) => ({ value: row.member.id, label: userName(row.member) })),
    },
    ...(!project
      ? [
          {
            key: "member",
            label: "添加成员",
            type: "select" as const,
            options: members.map((row) => ({ value: row.member.id, label: userName(row.member) })),
          },
        ]
      : []),
  ];
}

export default function Projects(props: CoreProps) {
  const { client, workspaceSlug, onNavigate } = props;
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}`;
  const { data, error, loading, refresh } = useData<NamedEntity[]>(client, `${base}/projects/`);
  const workspace = useData<Entity>(client, `${base}/`);
  const members = useData<Member[]>(client, `${base}/members/`);
  const session = useData<Session>(client, "/api/lab/session/");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | "delete" | "details" | null>(null);
  const [selected, setSelected] = useState<Entity>();
  const [pendingProject, setPendingProject] = useState<Entity>();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const all = records(data);
  const projects = all.filter(
    (project) =>
      String(project.name).toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (!favoritesOnly || project.is_favorite) &&
      (showArchived ? Boolean(project.archived_at) : !project.archived_at)
  );
  const canCreate = Number(workspace.data?.role) >= 15;
  const canAdmin = Number(selected?.member_role) >= 20 || Number(workspace.data?.role) >= 20;
  const close = () => {
    setModal(null);
    setPendingProject(undefined);
  };
  async function save(values: Record<string, string>) {
    const body: Record<string, unknown> = {
      name: values.name.trim(),
      identifier: values.identifier.trim().toUpperCase(),
      description: values.description,
      network: Number(values.network || 0),
      project_lead: values.project_lead || null,
    };
    if (modal === "create")
      Object.assign(body, {
        cycle_view: true,
        module_view: true,
        issue_views_view: true,
        page_view: true,
        timezone: "Asia/Shanghai",
      });
    const result = await client.request<Entity>(
      modal === "edit" || pendingProject
        ? `${base}/projects/${selected?.id ?? pendingProject?.id}/`
        : `${base}/projects/`,
      modal === "edit" || pendingProject ? "PATCH" : "POST",
      body
    );
    if (modal === "create") setPendingProject(result);
    if (
      modal === "create" &&
      values.member &&
      values.member !== values.project_lead &&
      values.member !== session.data?.user.id
    )
      await client.request(`${base}/projects/${result.id}/members/`, "POST", {
        members: [{ member_id: values.member, role: 15 }],
      });
    await refresh();
    if (modal === "create" && result.id) onNavigate({ page: "tasks", projectId: result.id });
  }
  return (
    <>
      <PageHeading title="项目">
        {canCreate && <AddButton onClick={() => setModal("create")}>新项目</AddButton>}
      </PageHeading>
      <label className="core-search">
        <input
          aria-label="搜索项目"
          placeholder="搜索项目"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="core-tabs">
        <button className={`chip ${!favoritesOnly ? "active" : ""}`} onClick={() => setFavoritesOnly(false)}>
          全部项目
        </button>
        <button className={`chip ${favoritesOnly ? "active" : ""}`} onClick={() => setFavoritesOnly(true)}>
          收藏
        </button>
        <button className={`chip ${showArchived ? "active" : ""}`} onClick={() => setShowArchived(!showArchived)}>
          已归档
        </button>
      </div>
      <ResultState loading={loading} error={error}>
        <div className="list">
          {projects.map((project) => (
            <article className="card" key={project.id}>
              <div className="row">
                <span className="core-project-icon">{String(project.identifier ?? "P").slice(0, 2)}</span>
                <button
                  className="core-task-name"
                  onClick={() => onNavigate({ page: "tasks", projectId: String(project.id) })}
                >
                  {project.name}
                </button>
                <button
                  className="icon-button"
                  aria-label={`${project.name}项目操作`}
                  onClick={() => {
                    setSelected(project);
                    setModal("details");
                  }}
                >
                  <MoreHorizontal size={20} />
                </button>
              </div>
              {Boolean(project.description) && <p className="muted">{String(project.description)}</p>}
              <div className="core-task-meta">
                <span>{String(project.identifier)}</span>
                <span>{Number(project.network) === 0 ? "私密" : "公开"}</span>
                {Boolean(project.archived_at) && <span>已归档</span>}
              </div>
              <div className="core-card-actions">
                <ActionButton
                  className="chip"
                  action={() =>
                    client.request(
                      `${base}/user-favorite-projects/${project.is_favorite ? `${project.id}/` : ""}`,
                      project.is_favorite ? "DELETE" : "POST",
                      project.is_favorite ? undefined : { project: project.id }
                    )
                  }
                  onDone={() => {
                    void refresh();
                  }}
                >
                  <Star size={15} fill={project.is_favorite ? "currentColor" : "none"} />
                  {project.is_favorite ? "已收藏" : "收藏"}
                </ActionButton>
                <button className="chip" onClick={() => onNavigate({ page: "tasks", projectId: String(project.id) })}>
                  任务
                  <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ))}
          {!projects.length && <Empty>暂无项目</Empty>}
        </div>
      </ResultState>
      <ErrorMessage error={workspace.error} />
      {(modal === "create" || modal === "edit") && (
        <FormSheet
          key={`${modal}-${selected?.id ?? "new"}`}
          title={modal === "create" ? "创建项目" : "编辑项目"}
          fields={projectFields(modal === "edit" ? selected : undefined, members.data)}
          onSubmit={save}
          onClose={close}
        />
      )}
      {modal === "details" && selected && (
        <Sheet title={String(selected.name)} onClose={close}>
          <DetailFields
            values={[
              ["项目标识", String(selected.identifier)],
              ["可见性", Number(selected.network) === 0 ? "私密" : "公开"],
              ["描述", String(selected.description || "暂无描述")],
            ]}
          />
          <div className="list">
            <button
              className="button"
              onClick={() => {
                close();
                onNavigate({ page: "tasks", projectId: String(selected.id) });
              }}
            >
              打开任务
            </button>
            {!selected.archived_at && (
              <button
                className="button"
                onClick={() => {
                  close();
                  onNavigate({ page: "project-overview", projectId: String(selected.id) });
                }}
              >
                项目概览
              </button>
            )}
            {canAdmin && (
              <>
                <button className="button" onClick={() => setModal("edit")}>
                  编辑项目
                </button>
                <ActionButton
                  action={() =>
                    client.request(`${base}/projects/${selected.id}/archive/`, selected.archived_at ? "DELETE" : "POST")
                  }
                  onDone={() => {
                    close();
                    void refresh();
                  }}
                >
                  <Archive size={17} />
                  {selected.archived_at ? "取消归档" : "归档项目"}
                </ActionButton>
                <button className="button danger" onClick={() => setModal("delete")}>
                  删除项目
                </button>
              </>
            )}
          </div>
        </Sheet>
      )}
      {modal === "delete" && selected && (
        <FormSheet
          title="删除项目"
          fields={[{ key: "confirmation", label: `输入「${selected.name}」确认删除`, required: true }]}
          onClose={close}
          onSubmit={async (values) => {
            if (values.confirmation !== selected.name) throw new Error("项目名称不一致");
            await client.request(`${base}/projects/${selected.id}/`, "DELETE");
            await refresh();
          }}
        />
      )}
    </>
  );
}
