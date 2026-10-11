import { useContext, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Star } from "lucide-react";
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
import { DetailFields, Empty, ResultState } from "./shared";
import { CanonicalIcon, MobileHeaderContext } from "../../components/navigation";
// oxlint-disable-next-line import/no-unassigned-import -- live V6 component adapters
import "./v6.css";
import { dateLabel, userName, type Session, type Member, type CoreProps, type NamedEntity } from "./model";

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
  const header = useContext(MobileHeaderContext);
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}`;
  const { data, error, loading, refresh } = useData<NamedEntity[]>(client, `${base}/projects/details/`);
  const projectStats = useData<Entity[]>(client, `${base}/project-stats/`);
  const workspaceMembership = useData<Pick<Member, "role">>(client, `${base}/workspace-members/me/`);
  const members = useData<Member[]>(client, `${base}/members/`);
  const session = useData<Session>(client, "/api/lab/session/");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | "delete" | "details" | null>(null);
  const [selected, setSelected] = useState<Entity>();
  const selectedDetail = useData<Entity>(
    client,
    selected && !selected.archived_at ? `${base}/projects/${selected.id}/` : null
  );
  const fullSelected = selectedDetail.data?.id === selected?.id ? selectedDetail.data : undefined;
  const [pendingProject, setPendingProject] = useState<Entity>();
  const [projectFilter, setProjectFilter] = useState("all");
  const [filterPanel, setFilterPanel] = useState(false);
  const [visibility, setVisibility] = useState("");
  const [orderBy, setOrderBy] = useState("name");
  const [showArchived, setShowArchived] = useState(false);
  const all = records(data);
  const projects = all.filter(
    (project) =>
      `${project.name} ${project.identifier}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (projectFilter !== "favorites" || project.is_favorite) &&
      (projectFilter !== "mine" || project.is_member || project.project_lead === session.data?.user.id) &&
      (!visibility || String(project.network) === visibility) &&
      (showArchived ? Boolean(project.archived_at) : !project.archived_at)
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- Sorting a newly filtered array supports Android WebView 95.
  projects.sort((left, right) =>
    orderBy === "updated"
      ? String(right.updated_at).localeCompare(String(left.updated_at))
      : String(left.name).localeCompare(String(right.name), "zh-CN")
  );
  const canCreate = Number(workspaceMembership.data?.role) >= 15;
  const canAdmin = Number(selected?.member_role) >= 20 || Number(workspaceMembership.data?.role) >= 20;
  const close = () => {
    setModal(null);
    setSelected(undefined);
    setPendingProject(undefined);
  };
  async function save(values: Record<string, string>) {
    if (modal === "edit" && (!fullSelected || selectedDetail.loading || selectedDetail.error))
      throw new Error("请先加载项目详情");
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
    if (modal === "edit") await selectedDetail.refresh(result, { revalidate: false });
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
      <PageHeading title="工作空间" onBack={() => onNavigate({ page: "home" })}>
        <button className="m3-icon-button" aria-label="打开工作台" onClick={() => onNavigate({ page: "more" })}>
          <CanonicalIcon name="apps" size={22} />
        </button>
      </PageHeading>
      <main className="m3-projects-body">
        <div className="projects-title-row">
          <h1>项目</h1>
          <span className="project-count">{projects.length} 个项目</span>
        </div>
        <label className="m3-searchbar">
          <CanonicalIcon name="search" size={22} />
          <input
            type="search"
            aria-label="搜索项目"
            placeholder="搜索项目"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="m3-tabs m3-project-tabs" role="tablist" aria-label="项目筛选">
          {[
            ["all", "全部"],
            ["mine", "我的项目"],
            ["favorites", "收藏"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={projectFilter === key ? "active" : ""}
              role="tab"
              aria-selected={projectFilter === key}
              onClick={() => setProjectFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="m3-list-toolbar">
          <button onClick={() => setFilterPanel(true)}>
            {visibility === "0" ? "私有项目" : visibility === "2" ? "公开项目" : "全部状态"}
            <CanonicalIcon name="down" size={14} />
          </button>
          <button onClick={() => setFilterPanel(true)}>
            <CanonicalIcon name="sort" size={17} />
            {orderBy === "updated" ? "按更新" : "按名称"}
          </button>
        </div>
        <ResultState loading={loading} error={error}>
          <div className="v6-project-list">
            {projects.map((project) => {
              const metrics = records(projectStats.data).find((row) => row.id === project.id);
              const total = Number(metrics?.total_issues ?? 0);
              const complete = Number(metrics?.completed_issues ?? 0);
              const lead = members.data?.find((row) => row.member.id === project.project_lead)?.member;
              const open = () =>
                onNavigate({
                  page: project.archived_at ? "archived-tasks" : "project-overview",
                  projectId: String(project.id),
                });
              return (
                <article className="m3-project-card" key={project.id}>
                  <div className="project-leading">
                    <button
                      className="m3-project-symbol"
                      aria-label={`${project.name}项目操作`}
                      onClick={() => {
                        setSelected(project);
                        setModal("details");
                      }}
                    >
                      <CanonicalIcon name="ocean" size={28} />
                    </button>
                    <div>
                      <h2>
                        <button className="v6-title-button" onClick={open}>
                          {project.name}
                        </button>
                      </h2>
                      <div className="project-code-line">
                        <strong>{String(project.identifier)}</strong>
                        <span>·</span>
                        <CanonicalIcon name="lock" size={12} />
                        <span>{Number(project.network) === 0 ? "私有项目" : "公开项目"}</span>
                      </div>
                    </div>
                  </div>
                  <p className="m3-project-description">{String(project.description || "暂无描述")}</p>
                  <div className="m3-project-owner">
                    <i className="m3-avatar">{lead ? userName(lead).slice(0, 1) : "—"}</i>
                    <span>{lead ? userName(lead) : "未设置负责人"}</span>
                    <span>
                      <CanonicalIcon name="users" size={15} />
                      {String(
                        metrics?.total_members ?? (Array.isArray(project.members) ? project.members.length : "—")
                      )}{" "}
                      名成员
                    </span>
                  </div>
                  <div className="m3-project-bottom">
                    <time>{project.updated_at ? `${dateLabel(project.updated_at)}更新` : "未更新"}</time>
                    <button className="m3-button text" onClick={open}>
                      打开项目
                      <CanonicalIcon name="arrow" size={17} />
                    </button>
                  </div>
                  {metrics && total > 0 && (
                    <div
                      className="m3-project-progress"
                      role="progressbar"
                      aria-label="项目进展"
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-valuenow={complete}
                    >
                      <span style={{ width: `${Math.min(100, Math.max(0, (complete / total) * 100))}%` }} />
                    </div>
                  )}
                </article>
              );
            })}
            {!projects.length && <Empty>暂无项目</Empty>}
          </div>
        </ResultState>
        <button className="m3-archive" onClick={() => setShowArchived(!showArchived)}>
          <CanonicalIcon name="archive" size={22} />
          {showArchived ? "返回活跃项目" : "已归档项目"}
          <CanonicalIcon name="chevron" size={18} />
        </button>
      </main>
      {canCreate &&
        (header?.fab ? (
          createPortal(
            <button className="m3-fab" onClick={() => setModal("create")}>
              <CanonicalIcon name="plus" size={22} />
              新建项目
            </button>,
            header.fab
          )
        ) : (
          <button className="m3-fab" onClick={() => setModal("create")}>
            <CanonicalIcon name="plus" size={22} />
            新建项目
          </button>
        ))}
      {filterPanel && (
        <FormSheet
          title="项目筛选与排序"
          fields={[
            {
              key: "visibility",
              label: "可见性",
              type: "select",
              value: visibility,
              options: [
                { value: "", label: "全部状态" },
                { value: "0", label: "私有项目" },
                { value: "2", label: "公开项目" },
              ],
            },
            {
              key: "order",
              label: "排序",
              type: "select",
              value: orderBy,
              options: [
                { value: "name", label: "按名称排序" },
                { value: "updated", label: "按更新时间排序" },
              ],
            },
          ]}
          onSubmit={async (values) => {
            setVisibility(values.visibility);
            setOrderBy(values.order);
          }}
          onClose={() => setFilterPanel(false)}
        />
      )}
      <ErrorMessage error={workspaceMembership.error} />
      {(modal === "create" ||
        (modal === "edit" && fullSelected && !selectedDetail.loading && !selectedDetail.error)) && (
        <FormSheet
          key={`${modal}-${selected?.id ?? "new"}`}
          title={modal === "create" ? "创建项目" : "编辑项目"}
          fields={projectFields(modal === "edit" ? fullSelected : undefined, members.data)}
          onSubmit={save}
          onClose={close}
        />
      )}
      {modal === "edit" && (!fullSelected || selectedDetail.loading || selectedDetail.error) && (
        <Sheet title="编辑项目" onClose={close}>
          <ResultState loading={selectedDetail.loading} error={selectedDetail.error}>
            {selectedDetail.error && <ActionButton action={() => selectedDetail.refresh()}>重试</ActionButton>}
          </ResultState>
        </Sheet>
      )}
      {modal === "details" && selected && (
        <Sheet title={String(fullSelected?.name ?? selected.name)} onClose={close}>
          {selected.archived_at ? (
            <DetailFields
              values={[
                ["项目标识", String(selected.identifier)],
                ["状态", "已归档"],
              ]}
            />
          ) : (
            <ResultState loading={selectedDetail.loading} error={selectedDetail.error}>
              {fullSelected && !selectedDetail.error && (
                <DetailFields
                  values={[
                    ["项目标识", String(fullSelected.identifier)],
                    ["可见性", Number(fullSelected.network) === 0 ? "私密" : "公开"],
                    ["描述", String(fullSelected.description || "暂无描述")],
                  ]}
                />
              )}
              {selectedDetail.error && <ActionButton action={() => selectedDetail.refresh()}>重试</ActionButton>}
            </ResultState>
          )}
          <div className="list">
            <ActionButton
              action={() =>
                client.request(
                  `${base}/user-favorite-projects/${selected.is_favorite ? `${selected.id}/` : ""}`,
                  selected.is_favorite ? "DELETE" : "POST",
                  selected.is_favorite ? undefined : { project: selected.id }
                )
              }
              onDone={() => {
                close();
                void refresh();
              }}
            >
              <Star size={15} fill={selected.is_favorite ? "currentColor" : "none"} />
              {selected.is_favorite ? "取消收藏" : "收藏项目"}
            </ActionButton>
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
                {!selected.archived_at && (
                  <button
                    className="button"
                    disabled={!fullSelected || selectedDetail.loading || Boolean(selectedDetail.error)}
                    onClick={() => setModal("edit")}
                  >
                    编辑项目
                  </button>
                )}
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
