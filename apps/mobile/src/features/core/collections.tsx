import { useEffect, useMemo, useState } from "react";
import { Archive, MoreHorizontal, Star } from "lucide-react";
import { CanonicalIcon } from "../../components/navigation";
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
import {
  AddButton,
  DetailFields,
  Empty,
  MultiSelectSheet,
  ProjectPicker,
  ResultState,
  TaskSearchSheet,
} from "./shared";
import {
  CoreService,
  dateLabel,
  issueRows,
  moduleStatuses,
  priorities,
  userName,
  type CoreProps,
  type Member,
  type Session,
} from "./model";
import { ProjectTasks } from "./tasks";
import { layoutValue } from "./preferences";
import { CollectionStats } from "./collection-stats";

const sectionTitles: Record<string, string> = { cycles: "周期", modules: "模块", views: "视图" };
function firstFilter(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export default function Collections(props: CoreProps) {
  if (!props.projectId)
    return (
      <>
        <PageHeading title={sectionTitles[props.section] ?? "项目视图"} />
        <ProjectPicker {...props} />
      </>
    );
  return <ProjectCollections {...props} projectId={props.projectId} />;
}

function ProjectCollections(props: CoreProps & { projectId: string }) {
  const { client, workspaceSlug, projectId, section, onNavigate } = props;
  const service = useMemo(() => new CoreService(client, workspaceSlug, projectId), [client, workspaceSlug, projectId]);
  const base = `${service.projectPath}/${section}/`;
  const collection = useData(client, base);
  const project = useData<Entity>(client, `${service.projectPath}/`);
  const members = useData<Member[]>(client, `${service.projectPath}/members/`);
  const states = useData<Entity[]>(client, `${service.projectPath}/states/`);
  const session = useData<Session>(client, "/api/lab/session/");
  const [selected, setSelected] = useState<Entity>();
  const [modal, setModal] = useState<string>();
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [order, setOrder] = useState(section === "cycles" ? "start" : "name");
  const selectedData = useData<Entity>(client, selected?.id ? `${base}${selected.id}/` : null);
  const row = selectedData.data ?? selected;
  const [showArchived, setShowArchived] = useState(false);
  const archived = useData(
    client,
    showArchived && section !== "views" ? `${service.projectPath}/archived-${section}/` : null
  );
  const isView = section === "views";
  const title = sectionTitles[section] ?? "集合";
  const role = Number(project.data?.member_role);
  const canCreate = isView ? role >= 5 : role >= 15;
  const owner = row?.owned_by ?? row?.owned_by_id ?? row?.created_by;
  const canEdit =
    (isView ? role >= 5 : role >= 15) &&
    !row?.archived_at &&
    !row?.is_locked &&
    (!isView || owner === session.data?.user.id);
  const canDelete = !row?.is_locked && (role >= 20 || owner === session.data?.user.id);
  const collectionStatus = (item: Entity) => {
    if (section === "cycles") {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (item.end_date && new Date(String(item.end_date)).getTime() < now.getTime())
        return { key: "completed", label: "已完成" };
      if (item.start_date && new Date(String(item.start_date)).getTime() > now.getTime())
        return { key: "upcoming", label: "即将开始" };
      return { key: "started", label: "进行中" };
    }
    if (section === "modules")
      return {
        key: item.status === "in-progress" ? "started" : String(item.status),
        label: moduleStatuses.find((status) => status.value === item.status)?.label ?? "已计划",
      };
    return {
      key: "all",
      label:
        (
          { list: "列表", board: "看板", timeline: "时间线", calendar: "日历", records: "表格" } as Record<
            string,
            string
          >
        )[layoutValue((item.display_filters as Entity | undefined)?.layout)] ?? "列表",
    };
  };
  const listRows = records(showArchived ? archived.data : collection.data).filter(
    (item) =>
      String(item.name).toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (listFilter === "all" ||
        (listFilter === "favorites" && item.is_favorite) ||
        collectionStatus(item).key === listFilter)
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- Sorting a fresh filtered array supports Android WebView 95.
  listRows.sort((left, right) =>
    order === "start"
      ? String(left.start_date ?? "").localeCompare(String(right.start_date ?? ""))
      : String(left.name).localeCompare(String(right.name), "zh-CN")
  );
  const membershipOptions = (members.data ?? [])
    .filter((member) => member.is_active !== false)
    .map((member) => ({ value: member.member.id, label: userName(member.member) }));
  useEffect(() => {
    setSelected(undefined);
    setModal(undefined);
  }, [section, projectId]);
  useEffect(() => {
    if (!selected) return;
    const handleBack = (event: Event) => {
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSelected(undefined);
    };
    window.addEventListener("mobileBack", handleBack, { capture: true });
    return () => window.removeEventListener("mobileBack", handleBack, { capture: true });
  }, [selected]);
  const filter = row?.filters && typeof row.filters === "object" ? (row.filters as Entity) : {};
  function fields(edit: boolean): FormField[] {
    const value = edit ? row : undefined;
    const list: FormField[] = [
      { key: "name", label: `${title}名称`, value: value?.name, required: true },
      { key: "description", label: "描述", type: "textarea", value: value?.description },
    ];
    if (section === "cycles")
      list.push(
        {
          key: "start_date",
          label: "开始日期",
          type: "date",
          value: value?.start_date ? String(value.start_date).slice(0, 10) : "",
        },
        {
          key: "end_date",
          label: "结束日期",
          type: "date",
          value: value?.end_date ? String(value.end_date).slice(0, 10) : "",
        }
      );
    if (section === "modules")
      list.push(
        { key: "status", label: "状态", type: "select", value: value?.status ?? "planned", options: moduleStatuses },
        {
          key: "lead_id",
          label: "负责人",
          type: "select",
          value: value?.lead_id ?? value?.lead,
          options: membershipOptions,
        },
        { key: "start_date", label: "开始日期", type: "date", value: value?.start_date },
        { key: "target_date", label: "截止日期", type: "date", value: value?.target_date }
      );
    if (isView) {
      const display = value?.display_filters as Entity | undefined;
      list.push(
        {
          key: "state",
          label: "状态",
          type: "select",
          value: edit ? firstFilter(filter.state) : "",
          options: records(states.data).map((state) => ({ value: String(state.id), label: String(state.name) })),
        },
        {
          key: "priority",
          label: "优先级",
          type: "select",
          value: edit ? firstFilter(filter.priority) : "",
          options: priorities,
        },
        {
          key: "assignees",
          label: "负责人",
          type: "select",
          value: edit ? firstFilter(filter.assignees) : "",
          options: membershipOptions,
        },
        {
          key: "layout",
          label: "显示方式",
          type: "select",
          value: display?.layout ?? "list",
          options: [
            { value: "list", label: "列表" },
            { value: "kanban", label: "看板" },
            { value: "calendar", label: "日历" },
            { value: "gantt", label: "时间线" },
            { value: "spreadsheet", label: "记录" },
          ],
        }
      );
    }
    return list;
  }
  async function save(values: Record<string, string>) {
    const edit = modal === "edit";
    const body: Record<string, unknown> = { name: values.name.trim(), description: values.description };
    if (section === "cycles") {
      if (Boolean(values.start_date) !== Boolean(values.end_date)) throw new Error("请同时填写开始和结束日期");
      if (values.start_date && values.end_date && values.start_date > values.end_date)
        throw new Error("开始日期不能晚于结束日期");
      body.start_date = values.start_date ? `${values.start_date}T00:00:00+08:00` : null;
      body.end_date = values.end_date ? `${values.end_date}T23:59:59+08:00` : null;
    }
    if (section === "modules")
      Object.assign(body, {
        status: values.status || "planned",
        lead_id: values.lead_id || null,
        start_date: values.start_date || null,
        target_date: values.target_date || null,
      });
    if (isView)
      Object.assign(body, {
        filters: {
          ...(edit ? filter : {}),
          state: values.state ? [values.state] : null,
          priority: values.priority ? [values.priority] : null,
          assignees: values.assignees ? [values.assignees] : null,
        },
        display_filters: {
          ...(edit && row?.display_filters && typeof row.display_filters === "object" ? row.display_filters : {}),
          layout: values.layout || "list",
        },
      });
    const saved = await client.request<Entity>(edit ? `${base}${row?.id}/` : base, edit ? "PATCH" : "POST", body);
    await collection.refresh();
    if (edit) await selectedData.refresh();
    if (!edit && saved.id) setSelected(saved);
  }
  const childPath =
    section === "cycles"
      ? `${base}${row?.id}/cycle-issues/`
      : section === "modules"
        ? `${base}${row?.id}/issues/`
        : undefined;
  const collectionIssues = useData(client, selected && !isView && childPath ? childPath : null);
  const refresh = async () => {
    await collection.refresh();
    await selectedData.refresh();
    await collectionIssues.refresh();
    await archived.refresh();
  };
  const close = () => setModal(undefined);
  return (
    <>
      <PageHeading
        title={selected ? String(row?.name ?? title) : `项目${title}`}
        onBack={selected ? () => setSelected(undefined) : undefined}
      >
        {selected ? (
          <button className="icon-button" aria-label={`${title}操作`} onClick={() => setModal("actions")}>
            <MoreHorizontal size={21} />
          </button>
        ) : (
          canCreate && <AddButton onClick={() => setModal("create")}>新{title}</AddButton>
        )}
      </PageHeading>
      {!selected ? (
        <>
          <div className="core-tabs">
            {(isView
              ? [
                  ["all", "全部视图"],
                  ["favorites", "收藏"],
                ]
              : section === "cycles"
                ? [
                    ["all", "全部"],
                    ["started", "进行中"],
                    ["upcoming", "即将开始"],
                    ["completed", "已完成"],
                  ]
                : [
                    ["all", "全部"],
                    ["started", "进行中"],
                    ["completed", "已完成"],
                  ]
            ).map(([key, label]) => (
              <button
                key={key}
                className={`chip ${listFilter === key ? "active" : ""}`}
                onClick={() => setListFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="core-rows">
            <button className="row" onClick={() => setFiltersOpen(true)}>
              <span className="row-main">{showArchived ? "已归档" : "列表"}</span>
              <span className="row-value">筛选 · {order === "start" ? "按开始日期" : "按名称"}</span>
              <CanonicalIcon name="arrow" size={16} />
            </button>
          </div>
          <ResultState
            loading={showArchived ? archived.loading : collection.loading}
            error={showArchived ? archived.error : collection.error}
          >
            <div className="list">
              {listRows.map((item) => (
                <article className="card" key={item.id}>
                  <button className="core-task-name" onClick={() => setSelected(item)}>
                    {String(item.name)}
                  </button>
                  {section === "cycles" ? (
                    <p className="core-card-subtitle">
                      {dateLabel(item.start_date)}—{dateLabel(item.end_date)}
                    </p>
                  ) : (
                    Boolean(item.description) && <p className="core-card-subtitle">{String(item.description)}</p>
                  )}
                  <div className="core-project-identity">
                    <span
                      className={`core-pill core-tone-${collectionStatus(item).key === "completed" ? "emerald" : "indigo"}`}
                    >
                      {collectionStatus(item).label}
                    </span>
                  </div>
                  <div className="core-card-meta">
                    {item.total_issues != null && (
                      <span>
                        <CanonicalIcon name="workItems" size={14} />
                        {String(item.total_issues)}项任务
                      </span>
                    )}
                    {item.completed_issues != null && (
                      <span>
                        <CanonicalIcon name="check" size={14} />
                        已完成 {String(item.completed_issues)}项
                      </span>
                    )}
                    {section === "modules" && item.target_date != null && (
                      <span>
                        <CanonicalIcon name="plan" size={14} />
                        {dateLabel(item.target_date)}截止
                      </span>
                    )}
                    {isView && (
                      <span>
                        <CanonicalIcon name="users" size={14} />
                        {Number(item.access) === 1 ? "公开" : "私有"}
                      </span>
                    )}
                  </div>
                  {!isView && Number(item.total_issues) > 0 && (
                    <div className="core-mini-progress">
                      <span
                        style={{
                          width: `${Math.min(100, Math.max(0, (Number(item.completed_issues ?? 0) / Number(item.total_issues)) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                  {!showArchived && (!isView || role >= 15) && (
                    <ActionButton
                      className="chip"
                      action={() =>
                        client.request(
                          `${service.projectPath}/user-favorite-${section}/${item.is_favorite ? `${item.id}/` : ""}`,
                          item.is_favorite ? "DELETE" : "POST",
                          item.is_favorite
                            ? undefined
                            : { [section === "cycles" ? "cycle" : section === "modules" ? "module" : "view"]: item.id }
                        )
                      }
                      onDone={() => {
                        void collection.refresh();
                      }}
                    >
                      <Star size={15} fill={item.is_favorite ? "currentColor" : "none"} />
                      {item.is_favorite ? "已收藏" : "收藏"}
                    </ActionButton>
                  )}
                </article>
              ))}
              {!listRows.length && <Empty>暂无{title}</Empty>}
            </div>
          </ResultState>
        </>
      ) : (
        <>
          <ResultState loading={selectedData.loading} error={selectedData.error}>
            {row && (
              <>
                <p className="muted">{String(row.description ?? "")}</p>
                <div className="card">
                  <DetailFields
                    values={
                      section === "cycles"
                        ? [
                            ["开始日期", dateLabel(row.start_date)],
                            ["结束日期", dateLabel(row.end_date)],
                            ["任务数", Number(row.total_issues ?? 0)],
                            ["已完成", Number(row.completed_issues ?? 0)],
                          ]
                        : section === "modules"
                          ? [
                              ["状态", moduleStatuses.find((status) => status.value === row.status)?.label ?? "已计划"],
                              [
                                "负责人",
                                userName(
                                  members.data?.find(
                                    (member) => member.member.id === row.lead_id || member.member.id === row.lead
                                  )?.member
                                ),
                              ],
                              ["开始日期", dateLabel(row.start_date)],
                              ["截止日期", dateLabel(row.target_date)],
                            ]
                          : [["可见性", Number(row.access) === 1 ? "项目共享" : "私人"]]
                    }
                  />
                  {canEdit && (
                    <div className="core-card-actions">
                      <button className="chip" onClick={() => setModal("edit")}>
                        编辑{title}
                      </button>
                      {section === "modules" && (
                        <button className="chip" onClick={() => setModal("members")}>
                          参与成员
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {!isView && <CollectionStats row={row} client={client} base={base} section={section} />}
              </>
            )}
          </ResultState>
          {!isView && (
            <>
              <div className="core-section-heading">
                <h2>任务</h2>
                {canEdit && (
                  <button className="chip" onClick={() => setModal("add-task")}>
                    添加任务
                  </button>
                )}
              </div>
              <ResultState loading={collectionIssues.loading} error={collectionIssues.error}>
                <div className="list">
                  {issueRows(collectionIssues.data).map((task) => (
                    <article className="card" key={task.id}>
                      <button
                        className="core-task-name"
                        onClick={() => onNavigate({ page: "issue", projectId, issueId: task.id })}
                      >
                        {task.name}
                      </button>
                      {canEdit && (
                        <ActionButton
                          className="chip"
                          action={() => client.request(`${childPath}${task.id}/`, "DELETE")}
                          onDone={() => {
                            void refresh();
                          }}
                        >
                          从{title}移除
                        </ActionButton>
                      )}
                    </article>
                  ))}
                  {!issueRows(collectionIssues.data).length && <Empty>暂无任务</Empty>}
                </div>
              </ResultState>
            </>
          )}
          {isView && (
            <ProjectTasks
              {...props}
              collectionTitle="视图任务"
              extraFilters={filter}
              initialLayout={layoutValue((row?.display_filters as Entity | undefined)?.layout)}
            />
          )}
        </>
      )}
      <ErrorMessage error={project.error ?? members.error ?? states.error} />
      {filtersOpen && (
        <FormSheet
          title="筛选与排序"
          fields={[
            { key: "query", label: `搜索${title}`, value: query },
            {
              key: "order",
              label: "排序",
              type: "select",
              value: order,
              options: [
                { value: "name", label: "按名称" },
                ...(!isView ? [{ value: "start", label: "按开始日期" }] : []),
              ],
            },
            ...(!isView
              ? [
                  {
                    key: "archived",
                    label: "项目归档",
                    type: "select" as const,
                    value: String(showArchived),
                    options: [
                      { value: "false", label: `当前${title}` },
                      { value: "true", label: "已归档" },
                    ],
                  },
                ]
              : []),
          ]}
          onSubmit={async (values) => {
            setQuery(values.query);
            setOrder(values.order);
            setShowArchived(values.archived === "true");
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {(modal === "create" || modal === "edit") && (
        <FormSheet
          key={`${modal}-${row?.id ?? "new"}`}
          title={`${modal === "edit" ? "编辑" : "创建"}${title}`}
          fields={fields(modal === "edit")}
          onSubmit={save}
          onClose={close}
        />
      )}
      {modal === "actions" && row && (
        <Sheet title={`${title}操作`} onClose={close}>
          <div className="list">
            {canEdit && (
              <button className="button" onClick={() => setModal("edit")}>
                编辑{title}
              </button>
            )}
            {!isView && role >= 15 && (
              <ActionButton
                action={() => client.request(`${base}${row.id}/archive/`, row.archived_at ? "DELETE" : "POST")}
                onDone={() => {
                  close();
                  setSelected(undefined);
                  void refresh();
                }}
              >
                <Archive size={17} />
                {row.archived_at ? "取消归档" : "归档"}
              </ActionButton>
            )}
            {canDelete && (
              <button className="button danger" onClick={() => setModal("delete")}>
                删除{title}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {modal === "delete" && row && (
        <FormSheet
          title={`删除${title}`}
          fields={[{ key: "confirmation", label: `输入「${row.name}」确认删除`, required: true }]}
          onClose={close}
          onSubmit={async (values) => {
            if (values.confirmation !== row.name) throw new Error("名称不一致");
            await client.request(`${base}${row.id}/`, "DELETE");
            setSelected(undefined);
            await refresh();
          }}
        />
      )}
      {modal === "members" && row && (
        <MultiSelectSheet
          title="参与成员"
          options={(members.data ?? [])
            .filter((member) => member.is_active !== false)
            .map((member) => ({ id: member.member.id, name: userName(member.member) }))}
          selected={Array.isArray(row.member_ids) ? (row.member_ids as string[]) : []}
          onClose={close}
          onSave={async (ids) => {
            await client.request(`${base}${row.id}/`, "PATCH", { member_ids: ids });
            await refresh();
          }}
        />
      )}
      {modal === "add-task" && row && childPath && (
        <TaskSearchSheet
          title={`添加到${title}`}
          client={client}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          exclude={issueRows(collectionIssues.data).map((task) => task.id)}
          onClose={close}
          onSelect={async (task) => {
            await client.request(childPath, "POST", { issues: [task.id] });
            await refresh();
          }}
        />
      )}
    </>
  );
}
