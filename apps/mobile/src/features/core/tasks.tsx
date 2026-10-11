import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CanonicalIcon, MobileHeaderContext } from "../../components/navigation";
// oxlint-disable-next-line import/no-unassigned-import -- live V6 component adapters
import "./v6.css";
import { useProjectMembers } from "./members";
import { DescriptionVersions } from "./versions";
import { CommentReactions } from "./reactions";
import { RichHtmlEditor } from "../../components/rich-editor";
import { TaskDocuments } from "../lab/documents";
import { useLabTransport } from "../lab/transport";
import { Gantt } from "../lab/gantt";
import { ArrowLeft, ArrowRight, Bell, Link2, Paperclip, Plus } from "lucide-react";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Html,
  PageHeading,
  Sheet,
  records,
  useData,
  type Entity,
  type FormField,
} from "../../components/ui";
import { DetailFields, Empty, MultiSelectSheet, ProjectPicker, ResultState, TaskSearchSheet } from "./shared";
import {
  CoreService,
  dateLabel,
  issueRows,
  plainText,
  priorities,
  priorityName,
  relationNames,
  userName,
  type CoreProps,
  type Member,
  type Session,
  type Task,
} from "./model";
import {
  displayFields,
  objectValue,
  layoutValue,
  preferencePayload,
  firstFilter,
  type TaskLayout,
} from "./preferences";

export function TaskCard({
  task,
  project,
  states = [],
  members = [],
  labels = [],
  cycles = [],
  modules = [],
  estimates = [],
  display,
  variant = "row",
  showStateLabel = true,
  onOpen,
}: {
  task: Task;
  project?: Entity;
  states?: Entity[];
  members?: Member[];
  labels?: Entity[];
  cycles?: Entity[];
  modules?: Entity[];
  estimates?: Entity[];
  display?: Entity;
  variant?: "row" | "card";
  showStateLabel?: boolean;
  onOpen: () => void;
}) {
  const state = states.find((row) => row.id === task.state_id);
  const names = task.assignee_ids
    ?.map((id) => userName(members.find((row) => row.member.id === id)?.member))
    .join("、");
  return (
    <button className={`px-task-row v6-task-card ${variant === "card" ? "v6-task-board-card" : ""}`} onClick={onOpen}>
      {display?.state !== false && (
        <span className="px-task-leading">
          <V6StateMark state={state} />
        </span>
      )}
      <div className="px-task-copy">
        <h2>{task.name}</h2>
        <div className="px-task-support">
          {showStateLabel && display?.state !== false && state && <span>{String(state.name)}</span>}
          {display?.key !== false && (
            <span>
              {String(project?.identifier ?? "")}
              {task.sequence_id ? `-${task.sequence_id}` : ""}
            </span>
          )}
          {display?.priority !== false && task.priority && task.priority !== "none" && (
            <span className={`px-high v6-priority-${task.priority}`}>
              <CanonicalIcon name={task.priority === "low" ? "down" : "priorityUp"} size={14} />
              {priorityName(task.priority)}
            </span>
          )}
          {display?.due_date !== false && task.target_date && <span>{dateLabel(task.target_date)}</span>}
        </div>
        <div className="core-task-meta v6-task-extra">
          {display?.labels !== false &&
            labels
              .filter((row) => task.label_ids?.includes(String(row.id)))
              .map((row) => <span key={row.id}>{String(row.name)}</span>)}
          {display?.cycle !== false && task.cycle_id && (
            <span>周期 · {String(cycles.find((row) => row.id === task.cycle_id)?.name ?? "已设置")}</span>
          )}
          {display?.module !== false && task.module_ids?.length ? (
            <span>
              模块 ·{" "}
              {modules
                .filter((row) => task.module_ids?.includes(String(row.id)))
                .map((row) => String(row.name))
                .join("、") || "已设置"}
            </span>
          ) : null}
          {display?.estimate !== false && task.estimate_point && (
            <span>估算 · {String(estimates.find((row) => row.id === task.estimate_point)?.value ?? "已设置")}</span>
          )}
          {display?.start_date !== false && task.start_date && <span>开始 · {dateLabel(task.start_date)}</span>}
          {display?.attachment_count !== false && Number(task.attachment_count) > 0 && (
            <span>附件 · {String(task.attachment_count)}</span>
          )}
          {display?.link !== false && Number(task.link_count) > 0 && <span>链接 · {String(task.link_count)}</span>}
          {display?.sub_issue_count !== false && Number(task.sub_issues_count) > 0 && (
            <span>子任务 · {String(task.sub_issues_count)}</span>
          )}
          {Boolean(display?.created_on) && <span>创建 · {dateLabel(task.created_at)}</span>}
          {Boolean(display?.updated_on) && <span>更新 · {dateLabel(task.updated_at)}</span>}
        </div>
      </div>
      {display?.assignee !== false && names && (
        <span className="px-task-owner">
          <span className="px-avatar">{names.slice(0, 1)}</span>
          <span>{names}</span>
        </span>
      )}
    </button>
  );
}

function V6StateMark({ state }: { state?: Entity }) {
  const kind =
    (
      {
        backlog: "planned",
        unstarted: "pending",
        started: "progress",
        completed: "done",
        cancelled: "cancelled",
      } as Record<string, string>
    )[String(state?.group)] ?? "pending";
  return (
    <i className={`px-state-mark px-state-${kind}`} aria-label={String(state?.name ?? "状态")}>
      {kind === "done" ? (
        <CanonicalIcon name="check" size={12} />
      ) : kind === "cancelled" ? (
        <CanonicalIcon name="close" size={12} />
      ) : null}
    </i>
  );
}

export function TaskForm({
  service,
  task,
  states,
  members = [],
  labels = [],
  parentId,
  onDone,
  onClose,
}: {
  service: CoreService;
  task?: Task;
  states: Entity[];
  members?: Member[];
  labels?: Entity[];
  parentId?: string;
  onDone: (task: Task, continueCreating?: boolean) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [created, setCreated] = useState<Task>();
  const continuing = useRef(false);
  const [generation, setGeneration] = useState(0);
  const estimates = useData<Entity[]>(service.client, `${service.projectPath}/project-estimates/`);
  const formCycles = useData<Entity[]>(service.client, !task ? `${service.projectPath}/cycles/` : null);
  const formModules = useData<Entity[]>(service.client, !task ? `${service.projectPath}/modules/` : null);
  const formParents = useData(
    service.client,
    !task && !parentId ? `${service.projectPath}/issues/?per_page=100&sub_issue=true` : null
  );
  const defaultState =
    states.find((row) => row.default) ?? states.find((row) => row.group === "unstarted") ?? states[0];
  const fields: FormField[] = [
    { key: "name", label: "任务标题", required: true, value: task?.name },
    {
      key: "state_id",
      label: "状态",
      type: "select",
      value: task?.state_id ?? defaultState?.id,
      options: states.map((row) => ({ value: String(row.id), label: String(row.name) })),
    },
    { key: "priority", label: "优先级", type: "select", value: task?.priority ?? "none", options: priorities },
    { key: "start_date", label: "开始日期", type: "date", value: task?.start_date },
    { key: "target_date", label: "截止日期", type: "date", value: task?.target_date },
  ];
  if (records(estimates.data).length)
    fields.push({
      key: "estimate_point",
      label: "估算",
      type: "select",
      value: task?.estimate_point,
      options: records(estimates.data).map((row) => ({ value: String(row.id), label: String(row.value) })),
    });
  if (!task)
    fields.push(
      {
        key: "assignee_id",
        label: "负责人",
        type: "select",
        options: members
          .filter((row) => row.is_active !== false)
          .map((row) => ({ value: row.member.id, label: userName(row.member) })),
      },
      {
        key: "label_id",
        label: "标签",
        type: "select",
        options: labels.map((row) => ({ value: String(row.id), label: String(row.name) })),
      },
      { key: "description", label: "描述", type: "rich" },
      {
        key: "continue",
        label: "创建后继续添加",
        type: "select",
        value: "no",
        options: [
          { value: "no", label: "打开任务详情" },
          { value: "yes", label: "继续添加" },
        ],
      },
      {
        key: "cycle",
        label: "周期",
        type: "select",
        options: records(formCycles.data).map((row) => ({ value: String(row.id), label: String(row.name) })),
      },
      {
        key: "module",
        label: "模块",
        type: "select",
        options: records(formModules.data).map((row) => ({ value: String(row.id), label: String(row.name) })),
      },
      ...(!parentId
        ? [
            {
              key: "parent",
              label: "父任务",
              type: "select" as const,
              options: issueRows(formParents.data).map((row) => ({ value: row.id, label: row.name })),
            },
          ]
        : [])
    );
  return (
    <FormSheet
      key={generation}
      title={task ? "编辑任务" : parentId ? "创建子任务" : "创建任务"}
      fields={fields}
      onClose={() => {
        if (continuing.current) {
          continuing.current = false;
          setCreated(undefined);
          setGeneration((value) => value + 1);
        } else onClose();
      }}
      onSubmit={async (values) => {
        if (values.start_date && values.target_date && values.start_date > values.target_date)
          throw new Error("开始日期不能晚于截止日期");
        const result = await service.saveTask(
          values,
          task?.id ?? created?.id,
          task ? undefined : values.assignee_id ? [values.assignee_id] : [],
          task ? undefined : values.label_id ? [values.label_id] : [],
          parentId || values.parent
        );
        if (!task) setCreated(result);
        if (!task && values.cycle)
          await service.client.request(`${service.projectPath}/cycles/${values.cycle}/cycle-issues/`, "POST", {
            issues: [result.id],
          });
        if (!task && values.module)
          await service.client.request(`${service.projectPath}/modules/${values.module}/issues/`, "POST", {
            issues: [result.id],
          });
        continuing.current = values.continue === "yes";
        await onDone(result, continuing.current);
      }}
    />
  );
}

function MonthCalendar({
  tasks,
  selectedDate,
  onSelect,
  month,
  onMonth,
}: {
  tasks: Task[];
  selectedDate: string;
  onSelect: (date: string) => void;
  month: Date;
  onMonth: (date: Date) => void;
}) {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (monthStart.getDay() + 6) % 7;
  const keyForDay = (day: number) =>
    `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (
    <>
      <div className="row">
        <button
          className="icon-button"
          aria-label="上个月"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <ArrowLeft size={18} />
        </button>
        <strong>
          {month.getFullYear()}年{month.getMonth() + 1}月
        </strong>
        <button
          className="icon-button"
          aria-label="下个月"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <ArrowRight size={18} />
        </button>
      </div>
      <div className="core-calendar">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span className="muted" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1,
            date = keyForDay(day);
          return (
            <button
              className="core-calendar-day"
              key={date}
              aria-pressed={date === selectedDate}
              onClick={() => onSelect(date)}
            >
              {day}
              {tasks.some((task) => task.target_date === date || task.start_date === date) && (
                <span className="core-calendar-dot" />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function Tasks(props: CoreProps) {
  const { projectId } = props;
  if (!projectId)
    return (
      <>
        <PageHeading title="任务" />
        <ProjectPicker {...props} section="tasks" />
      </>
    );
  return <ProjectTasks {...props} projectId={projectId} />;
}

export function ProjectTasks(
  props: CoreProps & {
    projectId: string;
    collectionPath?: string;
    extraFilters?: Record<string, unknown>;
    collectionTitle?: string;
    initialLayout?: TaskLayout;
  }
) {
  const {
    client,
    workspaceSlug,
    projectId,
    onNavigate,
    collectionPath,
    extraFilters,
    collectionTitle,
    initialLayout = "list",
  } = props;
  const service = useMemo(() => new CoreService(client, workspaceSlug, projectId), [client, workspaceSlug, projectId]);
  const project = useData<Entity>(client, `${service.projectPath}/`);
  const states = useData<Entity[]>(client, `${service.projectPath}/states/`);
  const members = useProjectMembers(client, workspaceSlug, projectId);
  const labels = useData<Entity[]>(client, `${service.projectPath}/issue-labels/`);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<TaskLayout>(initialLayout);
  const preferences = useData<Entity>(client, `${service.projectPath}/user-properties/`);
  const [orderBy, setOrderBy] = useState("-created_at");
  const [groupBy, setGroupBy] = useState("state");
  const [secondaryGroup, setSecondaryGroup] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [subIssues, setSubIssues] = useState(true);
  const [advanced, setAdvanced] = useState<Entity>({});
  const availableCycles = useData<Entity[]>(client, `${service.projectPath}/cycles/`),
    availableModules = useData<Entity[]>(client, `${service.projectPath}/modules/`);
  const availableEstimates = useData<Entity[]>(
    client,
    Number(project.data?.member_role) >= 15 ? `${service.projectPath}/project-estimates/` : null
  );
  const [assigneeId, setAssigneeId] = useState("");
  const [labelId, setLabelId] = useState("");
  const defaultFields = ["key", "state", "priority", "assignee", "due_date"];
  const [fields, setFields] = useState(defaultFields);
  const [settings, setSettings] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const header = useContext(MobileHeaderContext);
  const [savingView, setSavingView] = useState(false);
  const [properties, setProperties] = useState(false);
  const [saved, setSaved] = useState(false);
  const display = Object.fromEntries(displayFields.map((row) => [row.id, fields.includes(row.id)]));
  const [stateId, setStateId] = useState("");
  const [priority, setPriority] = useState("");
  const [creating, setCreating] = useState(false);
  const [cursors, setCursors] = useState([""]);
  const [month, setMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString("en-CA"));
  useEffect(() => {
    if (!preferences.data || collectionTitle || collectionPath) return;
    const filters = objectValue(preferences.data.filters),
      displaySettings = objectValue(preferences.data.display_filters),
      displayProperties = objectValue(preferences.data.display_properties);
    setLayout(layoutValue(displaySettings.layout));
    setOrderBy(String(displaySettings.order_by ?? "-created_at"));
    setGroupBy(String(displaySettings.group_by ?? "state"));
    setSecondaryGroup(String(displaySettings.sub_group_by ?? ""));
    setShowEmpty(displaySettings.show_empty_groups === true);
    setSubIssues(displaySettings.sub_issue !== false);
    setAdvanced(
      Object.fromEntries(
        Object.entries(filters).filter(([key]) => !["state", "priority", "assignees", "labels"].includes(key))
      )
    );
    setStateId(firstFilter(filters.state));
    setPriority(firstFilter(filters.priority));
    setAssigneeId(firstFilter(filters.assignees));
    setLabelId(firstFilter(filters.labels));
    setFields(
      displayFields
        .filter((row) =>
          row.id in displayProperties
            ? displayProperties[row.id] !== false
            : ["key", "state", "priority", "assignee", "due_date"].includes(row.id)
        )
        .map((row) => row.id)
    );
  }, [preferences.data, collectionTitle, collectionPath]);
  const filterKey = JSON.stringify({ ...extraFilters, ...advanced });
  useEffect(() => {
    setCursors([""]);
  }, [projectId, stateId, priority, assigneeId, labelId, orderBy, subIssues, query, filterKey]);
  useEffect(() => {
    setLayout(initialLayout);
  }, [initialLayout]);
  const params = new URLSearchParams({ per_page: "100", sub_issue: String(subIssues) });
  const cursor = cursors[cursors.length - 1];
  if (cursor) params.set("cursor", cursor);
  for (const [key, value] of Object.entries({ ...advanced, ...extraFilters })) {
    if (value != null) params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  if (stateId) params.set("state", stateId);
  if (priority) params.set("priority", priority);
  if (assigneeId) params.set("assignees", assigneeId);
  if (labelId) params.set("labels", labelId);
  params.set("order_by", orderBy);
  if (query.trim()) params.set("name", query.trim());
  const items = useData<unknown>(client, `${collectionPath ?? `${service.projectPath}/issues/`}?${params}`);
  const summaryParams = new URLSearchParams({ per_page: "1", sub_issue: String(subIssues) });
  for (const [key, value] of Object.entries(extraFilters ?? {}))
    if (value != null) summaryParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  const summaryPath = `${collectionPath ?? `${service.projectPath}/issues/`}?${summaryParams}`;
  const issueTotal = useData<Entity>(client, summaryPath);
  const startedTotal = useData<Entity>(client, `${summaryPath}&state_group=started`);
  const highTotal = useData<Entity>(client, `${summaryPath}&priority=high`);
  const countLabel = (source: typeof issueTotal) =>
    source.loading || source.error || !source.data
      ? "—"
      : String(source.data.total_count ?? source.data.total_results ?? records(source.data).length);
  const fetchedTasks = issueRows(items.data);
  const tasks = fetchedTasks.filter(
    (task) =>
      (!query.trim() || task.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (!stateId || task.state_id === stateId) &&
      (!priority || task.priority === priority) &&
      (!assigneeId || task.assignee_ids?.includes(assigneeId)) &&
      (!labelId || task.label_ids?.includes(labelId))
  );
  const pageData =
    items.data && typeof items.data === "object" && !Array.isArray(items.data) ? (items.data as Entity) : undefined;
  const visible = tasks.filter(
    (task) => layout !== "calendar" || task.target_date === selectedDate || task.start_date === selectedDate
  );
  const canEdit = Number(project.data?.member_role) >= 15 && !collectionPath?.includes("archived-issues");
  const stateRows = records(states.data);
  const card = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      project={project.data}
      states={stateRows}
      members={members.data}
      labels={records(labels.data)}
      cycles={records(availableCycles.data)}
      modules={records(availableModules.data)}
      estimates={records(availableEstimates.data)}
      display={display}
      variant={layout === "board" ? "card" : "row"}
      showStateLabel={groupBy !== "state" || !["list", "board"].includes(layout)}
      onOpen={() => onNavigate({ page: "issue", projectId: task.project_id ?? projectId, issueId: task.id })}
    />
  );
  return (
    <>
      <PageHeading
        title={collectionTitle ?? String(project.data?.name ?? "任务")}
        onBack={() => onNavigate({ page: "project-overview", projectId })}
      >
        <button className="m3-icon-button px-icon-button" aria-label="筛选与显示" onClick={() => setSettings(true)}>
          <CanonicalIcon name="filter" size={20} />
        </button>
      </PageHeading>
      <main className="px-body px-list-body">
        <div className="px-list-id">{String(project.data?.identifier ?? "")}</div>
        <div className="px-view-control" role="tablist" aria-label="任务视图">
          {(
            [
              ["list", "列表", "list"],
              ["board", "看板", "board"],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              className={layout === key ? "px-view-selected" : ""}
              role="tab"
              aria-selected={layout === key}
              onClick={() => setLayout(key)}
            >
              <CanonicalIcon name={icon} size={key === "list" ? 20 : 19} />
              {label}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={["timeline", "calendar", "records"].includes(layout)}
            aria-expanded={viewsOpen}
            className={["timeline", "calendar", "records"].includes(layout) ? "px-view-selected" : ""}
            aria-label="更多任务视图"
            onClick={() => setViewsOpen(!viewsOpen)}
          >
            更多
            <CanonicalIcon name="down" size={16} />
          </button>
        </div>
        {viewsOpen && (
          <div className="px-view-menu">
            {(
              [
                ["timeline", "时间线", "gantt"],
                ["calendar", "日历", "calendar"],
                ["records", "表格", "table"],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                onClick={() => {
                  setLayout(key);
                  setViewsOpen(false);
                }}
              >
                <CanonicalIcon name={icon} size={20} />
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="px-chips">
          <button
            className={`m3-chip px-chip ${!stateId && !priority ? "px-chip-selected" : ""}`}
            onClick={() => {
              setStateId("");
              setPriority("");
            }}
          >
            <span>
              {!stateId && !priority && <CanonicalIcon name="check" size={15} />}全部任务 {countLabel(issueTotal)}
            </span>
          </button>
          <button
            className={`m3-chip px-chip ${stateId && stateRows.find((row) => row.id === stateId)?.group === "started" ? "px-chip-selected" : ""}`}
            onClick={() => {
              const started = stateRows.find((row) => row.group === "started");
              if (started) setStateId(String(started.id));
              setPriority("");
            }}
          >
            <span>进行中 {countLabel(startedTotal)}</span>
          </button>
          <button
            className={`m3-chip px-chip ${priority === "high" ? "px-chip-selected" : ""}`}
            onClick={() => {
              setStateId("");
              setPriority("high");
            }}
          >
            <span>高优先级 {countLabel(highTotal)}</span>
          </button>
        </div>
        {layout === "timeline" && <ProjectTimeline {...props} />}
        {layout === "calendar" && (
          <MonthCalendar
            tasks={tasks}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            month={month}
            onMonth={setMonth}
          />
        )}
        {layout !== "timeline" && (
          <ResultState loading={items.loading} error={items.error}>
            {layout === "board" || (groupBy && layout === "list") ? (
              <div className={layout === "board" ? "core-kanban" : "core-grouped-issues"}>
                {taskGroups(tasks, groupBy || "state", stateRows, members.data ?? [])
                  .filter(([, grouped]) => showEmpty || grouped.length)
                  .map(([name, grouped]) => (
                    <section className={layout === "board" ? "core-kanban-column" : "core-state-section"} key={name}>
                      <div className="px-group-heading">
                        <span>
                          {(groupBy || "state") === "state" && (
                            <V6StateMark state={stateRows.find((row) => row.name === name)} />
                          )}
                          {name}
                          <small>{grouped.length}</small>
                        </span>
                        <button
                          className="m3-icon-button px-icon-button"
                          aria-label="按状态分组"
                          onClick={() => setSettings(true)}
                        >
                          <CanonicalIcon name="more" size={20} />
                        </button>
                      </div>
                      <div className="px-task-list">
                        {secondaryGroup && secondaryGroup !== groupBy
                          ? taskGroups(grouped, secondaryGroup, stateRows, members.data ?? [])
                              .filter(([, rows]) => showEmpty || rows.length)
                              .map(([title, rows]) => (
                                <div key={title}>
                                  <h3 className="muted">{title}</h3>
                                  {rows.map(card)}
                                </div>
                              ))
                          : grouped.map(card)}
                        {!grouped.length && <Empty>暂无任务</Empty>}
                      </div>
                    </section>
                  ))}
              </div>
            ) : (
              <div className="list core-issue-list">
                {visible.map((task) =>
                  layout === "records" ? (
                    <article key={task.id} className="card">
                      <button
                        className="core-task-name"
                        onClick={() =>
                          onNavigate({ page: "issue", projectId: task.project_id ?? projectId, issueId: task.id })
                        }
                      >
                        {task.name}
                      </button>
                      <DetailFields
                        values={recordFields(
                          task,
                          project.data,
                          stateRows,
                          members.data ?? [],
                          records(labels.data),
                          fields,
                          records(availableCycles.data),
                          records(availableModules.data),
                          records(availableEstimates.data)
                        )}
                      />
                    </article>
                  ) : (
                    card(task)
                  )
                )}
                {!visible.length && <Empty>{layout === "calendar" ? "当天暂无任务" : "暂无任务"}</Empty>}
              </div>
            )}
          </ResultState>
        )}
        {layout !== "timeline" && (cursors.length > 1 || Boolean(pageData?.next_page_results)) && (
          <div className="core-pager">
            <button className="button" disabled={cursors.length <= 1} onClick={() => setCursors(cursors.slice(0, -1))}>
              上一页
            </button>
            <span className="muted">第 {cursors.length} 页</span>
            <button
              className="button"
              disabled={!pageData?.next_page_results}
              onClick={() => setCursors([...cursors, String(pageData?.next_cursor)])}
            >
              下一页
            </button>
          </div>
        )}
        <ErrorMessage error={project.error ?? states.error ?? members.error ?? labels.error ?? preferences.error} />
        <details className="v6-secondary-details">
          <summary>
            视图与更多操作
            <CanonicalIcon name="chevron" size={17} />
          </summary>
          <div className="core-tabs">
            <ActionButton
              className="chip"
              action={async () => {
                await client.request(
                  `${service.projectPath}/user-properties/`,
                  "PATCH",
                  preferencePayload(preferences.data, {
                    layout,
                    state: stateId,
                    priority,
                    assignees: assigneeId,
                    labels: labelId,
                    orderBy,
                    groupBy,
                    fields,
                  })
                );
                setSaved(true);
              }}
            >
              保存视图
            </ActionButton>
            {saved && <span className="muted">已保存</span>}
            <button className="chip" onClick={() => onNavigate({ page: "archived-tasks", projectId })}>
              归档任务
            </button>
          </div>
          <ActionButton
            className="chip"
            action={async () => {
              setStateId("");
              setPriority("");
              setAssigneeId("");
              setLabelId("");
              setAdvanced({
                ...Object.fromEntries(
                  Object.keys({ ...objectValue(preferences.data?.filters), ...advanced }).map((key) => [key, null])
                ),
                state_group: null,
                created_by: null,
                cycle: null,
                module: null,
                start_date: null,
                target_date: null,
              });
              setSaved(false);
            }}
          >
            清除筛选
          </ActionButton>
          <button className="chip" onClick={() => setSavingView(true)}>
            保存为视图
          </button>
          {savingView && (
            <FormSheet
              title="保存为视图"
              fields={[
                { key: "name", label: "视图名称", required: true },
                {
                  key: "access",
                  label: "可见性",
                  type: "select",
                  value: "0",
                  options: [
                    { value: "0", label: "私人" },
                    { value: "1", label: "项目共享" },
                  ],
                },
              ]}
              onClose={() => setSavingView(false)}
              onSubmit={async (values) => {
                const body = preferencePayload(preferences.data, {
                  layout,
                  state: stateId,
                  priority,
                  assignees: assigneeId,
                  labels: labelId,
                  orderBy,
                  groupBy,
                  fields,
                  extraFilters: advanced,
                  secondaryGroup,
                  showEmpty,
                  subIssues,
                });
                await client.request(`${service.projectPath}/views/`, "POST", {
                  name: values.name.trim(),
                  access: Number(values.access),
                  ...body,
                });
                onNavigate({ page: "views", projectId });
              }}
            />
          )}
          <button className="chip" onClick={() => setProperties(true)}>
            显示属性
          </button>
          {properties && (
            <MultiSelectSheet
              title="显示属性"
              options={displayFields}
              selected={fields}
              onClose={() => setProperties(false)}
              onSave={async (ids) => {
                setFields(ids);
                setSaved(false);
              }}
            />
          )}
        </details>
      </main>
      {canEdit &&
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
      {settings && (
        <FormSheet
          title="筛选、排序与分组"
          fields={[
            { key: "query", label: "搜索任务", value: query },
            {
              key: "state",
              label: "状态",
              type: "select",
              value: stateId,
              options: stateRows.map((row) => ({ value: String(row.id), label: String(row.name) })),
            },
            { key: "priority", label: "优先级", type: "select", value: priority, options: priorities },
            {
              key: "state_group",
              label: "状态组",
              type: "select",
              value: firstFilter(advanced.state_group),
              options: [
                { value: "backlog", label: "待办" },
                { value: "unstarted", label: "未开始" },
                { value: "started", label: "进行中" },
                { value: "completed", label: "已完成" },
                { value: "cancelled", label: "已取消" },
              ],
            },
            {
              key: "created_by",
              label: "创建人",
              type: "select",
              value: firstFilter(advanced.created_by),
              options: (members.data ?? []).map((row) => ({ value: row.member.id, label: userName(row.member) })),
            },
            {
              key: "cycle",
              label: "周期",
              type: "select",
              value: firstFilter(advanced.cycle),
              options: records(availableCycles.data).map((row) => ({ value: String(row.id), label: String(row.name) })),
            },
            {
              key: "module",
              label: "模块",
              type: "select",
              value: firstFilter(advanced.module),
              options: records(availableModules.data).map((row) => ({
                value: String(row.id),
                label: String(row.name),
              })),
            },
            {
              key: "start_date",
              label: "开始日期",
              type: "date",
              value: firstFilter(advanced.start_date).split(";")[0],
            },
            {
              key: "start_operator",
              label: "开始日期范围",
              type: "select",
              value: firstFilter(advanced.start_date).includes("after") ? "after" : "before",
              options: [
                { value: "before", label: "此日或之前" },
                { value: "after", label: "此日或之后" },
              ],
            },
            {
              key: "target_date",
              label: "截止日期",
              type: "date",
              value: firstFilter(advanced.target_date).split(";")[0],
            },
            {
              key: "target_operator",
              label: "截止日期范围",
              type: "select",
              value: firstFilter(advanced.target_date).includes("after") ? "after" : "before",
              options: [
                { value: "before", label: "此日或之前" },
                { value: "after", label: "此日或之后" },
              ],
            },
            {
              key: "secondary",
              label: "次级分组",
              type: "select",
              value: secondaryGroup,
              options: [
                { value: "", label: "不分组" },
                { value: "state", label: "状态" },
                { value: "priority", label: "优先级" },
                { value: "assignees", label: "负责人" },
              ],
            },
            {
              key: "empty",
              label: "显示空分组",
              type: "select",
              value: String(showEmpty),
              options: [
                { value: "true", label: "显示" },
                { value: "false", label: "隐藏" },
              ],
            },
            {
              key: "children",
              label: "显示子任务",
              type: "select",
              value: String(subIssues),
              options: [
                { value: "true", label: "显示" },
                { value: "false", label: "隐藏" },
              ],
            },
            {
              key: "order",
              label: "排序",
              type: "select",
              value: orderBy,
              options: [
                { value: "-created_at", label: "创建时间 · 新到旧" },
                { value: "created_at", label: "创建时间 · 旧到新" },
                { value: "target_date", label: "截止日期" },
                { value: "priority", label: "优先级" },
                { value: "name", label: "标题" },
              ],
            },
            {
              key: "group",
              label: "分组",
              type: "select",
              value: groupBy,
              options: [
                { value: "", label: "不分组" },
                { value: "state", label: "状态" },
                { value: "priority", label: "优先级" },
                { value: "assignees", label: "负责人" },
              ],
            },
            {
              key: "assignee",
              label: "负责人",
              type: "select",
              value: assigneeId,
              options: (members.data ?? []).map((row) => ({ value: row.member.id, label: userName(row.member) })),
            },
            {
              key: "label",
              label: "标签",
              type: "select",
              value: labelId,
              options: records(labels.data).map((row) => ({ value: String(row.id), label: String(row.name) })),
            },
          ]}
          onClose={() => setSettings(false)}
          onSubmit={async (values) => {
            setQuery(values.query);
            setStateId(values.state);
            setPriority(values.priority);
            setOrderBy(values.order);
            setGroupBy(values.group);
            setAssigneeId(values.assignee);
            setLabelId(values.label);
            setSecondaryGroup(values.secondary);
            setShowEmpty(values.empty === "true");
            setSubIssues(values.children === "true");
            setAdvanced({
              ...advanced,
              ...Object.fromEntries(
                ["state_group", "created_by", "cycle", "module"].map((key) => [key, values[key] ? [values[key]] : null])
              ),
              start_date: values.start_date ? [`${values.start_date};${values.start_operator}`] : null,
              target_date: values.target_date ? [`${values.target_date};${values.target_operator}`] : null,
            });
            setSaved(false);
          }}
        />
      )}
      {creating && (
        <TaskForm
          service={service}
          states={stateRows}
          members={members.data}
          labels={records(labels.data)}
          onClose={() => setCreating(false)}
          onDone={async (task, continueCreating) => {
            await items.refresh();
            if (!continueCreating) onNavigate({ page: "issue", projectId, issueId: task.id });
          }}
        />
      )}
    </>
  );
}

export function MyTasks(props: CoreProps) {
  const { client, workspaceSlug, onNavigate } = props;
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}`;
  const session = useData<Session>(client, "/api/lab/session/");
  const workspace = useData<Entity>(client, `${base}/`);
  const projects = useData<Entity[]>(client, `${base}/projects/`);
  const [tab, setTab] = useState("assigned");
  const [query, setQuery] = useState("");
  const [due, setDue] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [cursors, setCursors] = useState([""]);
  const userId = session.data?.user.id;
  const stats = useData<Entity>(client, userId ? `${base}/user-stats/${userId}/` : null);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDate = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
  const weekStats = useData<Entity>(
    client,
    userId ? `${base}/user-stats/${userId}/?completed_at=${weekDate};after` : null
  );
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const params = new URLSearchParams({ per_page: "100", sub_issue: "true" });
  if (userId) params.set(tab === "created" ? "created_by" : tab === "subscribed" ? "subscriber" : "assignees", userId);
  if (cursors[cursors.length - 1]) params.set("cursor", cursors[cursors.length - 1]);
  if (query.trim()) params.set("name", query.trim());
  if (due === "today") params.set("target_date", date);
  if (due === "overdue") {
    params.set("target_date", `${date};before`);
    params.set("state_group", "backlog,unstarted,started");
  }
  const items = useData(client, userId ? `${base}/user-issues/${userId}/?${params}` : null);
  const rows = issueRows(items.data).filter(
    (task) =>
      (!query || task.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (due === "all" || (task.target_date && (due === "today" ? task.target_date === date : task.target_date < date)))
  );
  const page = items.data as Entity | undefined;
  const distribution = records(stats.data?.state_distribution);
  const started = distribution.find((row) => row.state_group === "started")?.state_count;
  const statsRows = [
    ["未完成", stats.data?.pending_issues],
    ["进行中", started],
    ["本周完成", weekStats.data?.completed_issues],
  ];
  return (
    <>
      <PageHeading title="我的任务">
        <button className="icon-button" aria-label="筛选" onClick={() => setFilterOpen(true)}>
          <CanonicalIcon name="filter" size={21} />
        </button>
      </PageHeading>
      <div className="core-project-hero">
        <span>{userName(session.data?.user)}</span>
        <h1>我的任务</h1>
        <p>{String(workspace.data?.name ?? workspaceSlug)}</p>
      </div>
      <div className="core-segmented-tabs">
        {[
          ["assigned", "分配给我"],
          ["created", "我创建的"],
          ["subscribed", "订阅的"],
          ["overview", "概览"],
        ].map(([key, label]) => (
          <button
            className={tab === key ? "active" : ""}
            key={key}
            onClick={() => {
              setTab(key);
              setCursors([""]);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="core-profile-stats">
        {statsRows.map(([name, value]) => (
          <div key={String(name)}>
            <span>{String(name)}</span>
            <strong>{value === undefined ? "—" : String(value)}</strong>
          </div>
        ))}
      </div>
      {tab !== "overview" && (
        <>
          <div className="core-tabs">
            {[
              ["all", "全部"],
              ["today", "今天到期"],
              ["overdue", "已逾期"],
            ].map(([key, label]) => (
              <button
                className={`chip ${due === key ? "active" : ""}`}
                key={key}
                onClick={() => {
                  setDue(key);
                  setCursors([""]);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <ResultState loading={session.loading || items.loading} error={session.error ?? items.error}>
            <div className="list core-issue-list">
              {rows.map((task) => (
                <PersonalTaskCard
                  key={task.id}
                  task={task}
                  project={records(projects.data).find((project) => project.id === task.project_id)}
                  {...props}
                />
              ))}
              {!rows.length && <Empty>暂无任务</Empty>}
            </div>
          </ResultState>
        </>
      )}
      {!stats.loading && !stats.error && (tab === "overview" || distribution.length > 0) && (
        <>
          <div className="core-section-heading">
            <h2>个人概览</h2>
          </div>
          <ProfileDistribution rows={distribution} />
        </>
      )}
      {tab !== "overview" && (cursors.length > 1 || Boolean(page?.next_page_results)) && (
        <div className="core-pager">
          <button className="button" disabled={cursors.length <= 1} onClick={() => setCursors(cursors.slice(0, -1))}>
            上一页
          </button>
          <span className="muted">第 {cursors.length} 页</span>
          <button
            className="button"
            disabled={!page?.next_page_results}
            onClick={() => setCursors([...cursors, String(page?.next_cursor)])}
          >
            下一页
          </button>
        </div>
      )}
      <button className="button" onClick={() => onNavigate({ page: "activity" })}>
        查看个人活动
      </button>
      {filterOpen && (
        <FormSheet
          title="筛选任务"
          fields={[{ key: "query", label: "搜索任务", value: query }]}
          onSubmit={async (values) => {
            setQuery(values.query);
            setCursors([""]);
          }}
          onClose={() => setFilterOpen(false)}
        />
      )}
      <ErrorMessage error={stats.error ?? weekStats.error} />
    </>
  );
}
function PersonalTaskCard({ task, project, ...props }: CoreProps & { task: Task; project?: Entity }) {
  const base = `/api/workspaces/${encodeURIComponent(props.workspaceSlug)}/projects/${task.project_id}`;
  const states = useData<Entity[]>(props.client, task.project_id ? `${base}/states/` : null);
  const members = useData<Member[]>(props.client, task.project_id ? `${base}/members/` : null);
  return (
    <TaskCard
      task={task}
      project={project}
      states={records(states.data)}
      members={members.data}
      onOpen={() => props.onNavigate({ page: "issue", projectId: task.project_id, issueId: task.id })}
    />
  );
}
function ProfileDistribution({ rows }: { rows: Entity[] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.state_count ?? 0), 0);
  const colors: Record<string, string> = {
    completed: "#4f9d83",
    started: "#6d8d87",
    unstarted: "#a5adaf",
    backlog: "#ccd1d1",
    cancelled: "#ce7070",
  };
  const labels: Record<string, string> = {
    completed: "已完成",
    started: "进行中",
    unstarted: "待开始",
    backlog: "待安排",
    cancelled: "已取消",
  };
  let position = 0;
  const stops = rows.map((row) => {
    const from = position;
    position += (Number(row.state_count ?? 0) / Math.max(1, total)) * 100;
    return `${colors[String(row.state_group)] ?? "#a5adaf"} ${from}% ${position}%`;
  });
  return (
    <div className="card core-donut-wrap">
      <div
        className="core-donut"
        style={{ background: total ? `conic-gradient(${stops.join(",")})` : "var(--subtle)" }}
      >
        <div>
          <strong>{total}</strong>
          <small>任务总数</small>
        </div>
      </div>
      <div className="core-donut-legend">
        {rows.map((row) => (
          <div key={String(row.state_group)}>
            <i style={{ background: colors[String(row.state_group)] }} />
            <span>{labels[String(row.state_group)] ?? String(row.state_group)}</span>
            <strong>{String(row.state_count)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectTimeline(props: CoreProps & { projectId: string }) {
  const store = useLabTransport(props.client, props.workspaceSlug);
  return (
    <Gantt
      store={store}
      projectId={props.projectId}
      onOpenIssue={(project, issue) => props.onNavigate({ page: "issue", projectId: project, issueId: issue })}
    />
  );
}
function taskGroups(tasks: Task[], group: string, states: Entity[], members: Member[]): [string, Task[]][] {
  const groups = new Map<string, Task[]>();
  if (group === "state") for (const state of states) groups.set(String(state.name), []);
  if (group === "priority") for (const priority of priorities) groups.set(priority.label, []);
  for (const task of tasks) {
    const names =
      group === "priority"
        ? [priorityName(task.priority)]
        : group === "assignees"
          ? task.assignee_ids?.length
            ? task.assignee_ids.map((id) => userName(members.find((row) => row.member.id === id)?.member))
            : ["未分配"]
          : [String(states.find((row) => row.id === task.state_id)?.name ?? "其他")];
    for (const name of names) groups.set(name, [...(groups.get(name) ?? []), task]);
  }
  return [...groups.entries()];
}
function recordFields(
  task: Task,
  project: Entity | undefined,
  states: Entity[],
  members: Member[],
  labels: Entity[],
  fields: string[],
  cycles: Entity[] = [],
  modules: Entity[] = [],
  estimates: Entity[] = []
): [string, string][] {
  const values: Record<string, string> = {
    key: `${String(project?.identifier ?? "")}-${task.sequence_id ?? ""}`,
    state: String(states.find((row) => row.id === task.state_id)?.name ?? "未设置"),
    priority: priorityName(task.priority),
    assignee:
      task.assignee_ids?.map((id) => userName(members.find((row) => row.member.id === id)?.member)).join("、") ||
      "未分配",
    labels:
      labels
        .filter((row) => task.label_ids?.includes(String(row.id)))
        .map((row) => String(row.name))
        .join("、") || "无标签",
    cycle: String(cycles.find((row) => row.id === task.cycle_id)?.name ?? "无周期"),
    module:
      modules
        .filter((row) => task.module_ids?.includes(String(row.id)))
        .map((row) => String(row.name))
        .join("、") || "无模块",
    estimate: String(estimates.find((row) => row.id === task.estimate_point)?.value ?? "未设置"),
    start_date: dateLabel(task.start_date),
    due_date: dateLabel(task.target_date),
    attachment_count: String(task.attachment_count ?? 0),
    link: String(task.link_count ?? 0),
    sub_issue_count: String(task.sub_issues_count ?? 0),
    created_on: dateLabel(task.created_at),
    updated_on: dateLabel(task.updated_at),
  };
  return displayFields.filter((row) => fields.includes(row.id)).map((row) => [row.name, values[row.id]]);
}

export function ArchivedTasks(props: CoreProps) {
  if (!props.projectId)
    return (
      <>
        <PageHeading title="归档任务" />
        <ProjectPicker {...props} section="archived-tasks" />
      </>
    );
  const path = `/api/workspaces/${encodeURIComponent(props.workspaceSlug)}/projects/${props.projectId}/archived-issues/`;
  return <ProjectTasks {...props} projectId={props.projectId} collectionPath={path} collectionTitle="归档任务" />;
}

export function IssueDetail(props: CoreProps) {
  const { client, workspaceSlug, projectId, issueId } = props;
  if (!projectId || !issueId) return <Tasks {...props} />;
  return (
    <TaskDetail {...props} projectId={projectId} issueId={issueId} client={client} workspaceSlug={workspaceSlug} />
  );
}

function TaskDetail(props: CoreProps & { projectId: string; issueId: string }) {
  const { client, workspaceSlug, projectId, issueId, onNavigate } = props;
  const service = useMemo(() => new CoreService(client, workspaceSlug, projectId), [client, workspaceSlug, projectId]);
  const lab = useLabTransport(client, workspaceSlug);
  const path = service.taskPath(issueId);
  const detail = useData<Task>(client, path);
  const project = useData<Entity>(client, `${service.projectPath}/`);
  const session = useData<Session>(client, "/api/lab/session/");
  const states = useData<Entity[]>(client, `${service.projectPath}/states/`);
  const members = useProjectMembers(client, workspaceSlug, projectId);
  const labels = useData<Entity[]>(client, `${service.projectPath}/issue-labels/`);
  const comments = useData<Entity[]>(client, `${path}comments/`);
  const activities = useData<Entity[]>(client, `${path}history/?activity_type=issue-property`);
  const children = useData(client, `${path}sub-issues/`);
  const relations = useData<Record<string, Task[]>>(client, `${path}issue-relation/`);
  const links = useData<Entity[]>(client, `${path}issue-links/`);
  const attachmentPath = `/api/assets/v2/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${projectId}/issues/${issueId}/attachments/`;
  const attachments = useData<Entity[]>(client, attachmentPath);
  const cycles = useData<Entity[]>(client, `${service.projectPath}/cycles/`);
  const modules = useData<Entity[]>(client, `${service.projectPath}/modules/`);
  const task = detail.data;
  const [modal, setModal] = useState<string>();
  const [selected, setSelected] = useState<Entity>();
  const [commentText, setCommentText] = useState("");
  const [tab, setTab] = useState("activity");
  const [relationType, setRelationType] = useState("relates_to");
  const role = Number(project.data?.member_role);
  const myId = session.data?.user.id;
  const canEdit = Boolean(task && !task.archived_at && (role >= 15 || task.created_by === myId));
  const canAdmin = role >= 20;
  const stateRows = records(states.data),
    labelRows = records(labels.data),
    cycleRows = records(cycles.data),
    moduleRows = records(modules.data);
  const state = stateRows.find((row) => row.id === task?.state_id);
  const assigned =
    members.data
      ?.filter((row) => task?.assignee_ids?.includes(row.member.id))
      .map((row) => userName(row.member))
      .join("、") || "未分配";
  const taskLabels =
    labelRows
      .filter((row) => task?.label_ids?.includes(String(row.id)))
      .map((row) => String(row.name))
      .join("、") || "无标签";
  const taskCycle = cycleRows.find((row) => row.id === task?.cycle_id);
  const taskModules =
    moduleRows
      .filter((row) => task?.module_ids?.includes(String(row.id)))
      .map((row) => String(row.name))
      .join("、") || "未设置";
  const close = () => {
    setModal(undefined);
    setSelected(undefined);
  };
  const refresh = async () => {
    await detail.refresh();
    await children.refresh();
    await activities.refresh();
  };
  const openTask = (row: Task) =>
    onNavigate({ page: "issue", projectId: row.project_id ?? projectId, issueId: row.id });
  const childRows = issueRows(children.data);
  const relationRows = Object.entries(relations.data ?? {}).flatMap(([key, rows]) =>
    rows.map((row) => ({ ...row, relationKey: key }))
  );
  const fieldNames: Record<string, string> = {
    name: "标题",
    state: "状态",
    priority: "优先级",
    assignees: "负责人",
    labels: "标签",
    start_date: "开始日期",
    target_date: "截止日期",
    description: "描述",
    parent: "父任务",
    cycle: "周期",
    module: "模块",
  };
  return (
    <>
      <PageHeading
        title={task?.sequence_id ? `${String(project.data?.identifier ?? "任务")}-${task.sequence_id}` : "任务详情"}
        onBack={() => onNavigate({ page: "tasks", projectId })}
      >
        <button className="icon-button" aria-label="任务操作" onClick={() => setModal("actions")}>
          <CanonicalIcon name="more" size={22} />
        </button>
      </PageHeading>
      <ResultState loading={detail.loading} error={detail.error}>
        {task && (
          <>
            <main className="px-body px-detail-body">
              <h1 className="px-issue-title">{task.name}</h1>
              <IssueDescription html={task.description_html} />
              <div className="px-detail-controls">
                <button className="px-status-button" disabled={!canEdit} onClick={() => setModal("state")} title="状态">
                  <V6StateMark state={state} />
                  {String(state?.name ?? "状态")}
                  <CanonicalIcon name="down" size={15} />
                </button>
                <button
                  className={`px-priority-button v6-priority-${task.priority ?? "none"}`}
                  disabled={!canEdit}
                  onClick={() => setModal("edit")}
                  title={`优先级 · ${priorityName(task.priority)}`}
                >
                  <CanonicalIcon name={task.priority === "low" ? "down" : "priorityUp"} size={16} />
                  {priorityName(task.priority)}
                </button>
                <button
                  className="px-assignee-button"
                  disabled={!canEdit}
                  onClick={() => setModal("owners")}
                  title={`负责人 · ${assigned}`}
                >
                  <span className="px-avatar">{assigned.slice(0, 1)}</span>
                  {assigned}
                </button>
              </div>
              <div className="px-attributes">
                {(
                  [
                    ["开始日期", task.start_date, "edit"],
                    ["截止日期", task.target_date, "edit"],
                    ["标签", taskLabels === "无标签" ? null : taskLabels, "labels"],
                  ] as const
                ).map(([label, value, target]) => (
                  <button className="px-attribute-row" key={label} disabled={!canEdit} onClick={() => setModal(target)}>
                    <span className="px-attribute-label">
                      <CanonicalIcon name={target === "labels" ? "tag" : "calendar"} size={19} />
                      {label}
                    </span>
                    <span className="px-attribute-value">
                      {value
                        ? target === "labels"
                          ? value
                          : dateLabel(value)
                        : target === "labels"
                          ? "添加标签"
                          : "选择日期"}
                      <CanonicalIcon name="chevron" size={17} />
                    </span>
                  </button>
                ))}
              </div>
              <section className="px-activity">
                <header className="px-section-heading">
                  <h2>{tab === "comments" ? "评论" : "活动"}</h2>
                  <button
                    className="m3-icon-button px-icon-button"
                    aria-label="筛选活动"
                    onClick={() => setModal("activity-filter")}
                  >
                    <CanonicalIcon name="filter" size={19} />
                  </button>
                </header>
                {tab === "comments" ? (
                  <>
                    <ResultState loading={comments.loading} error={comments.error}>
                      <div className="list">
                        {records(comments.data).map((comment) => {
                          const actor = comment.actor_detail as Session["user"] | undefined;
                          return (
                            <article className="card" key={comment.id}>
                              <div className="core-comment-meta">
                                <strong>{userName(actor)}</strong>
                                <span>
                                  {dateLabel(comment.created_at)}
                                  {comment.edited_at ? " · 已编辑" : ""}
                                </span>
                              </div>
                              <Html html={comment.comment_html} />
                              <CommentReactions
                                service={service}
                                comment={comment}
                                userId={myId}
                                onDone={() => {
                                  void comments.refresh();
                                }}
                              />
                              {(canAdmin || comment.actor === myId) && (
                                <div className="core-comment-actions">
                                  <button
                                    className="chip"
                                    onClick={() => {
                                      setSelected(comment);
                                      setModal("comment");
                                    }}
                                  >
                                    编辑
                                  </button>
                                  <ActionButton
                                    className="chip"
                                    action={() => client.request(`${path}comments/${comment.id}/`, "DELETE")}
                                    onDone={() => {
                                      void comments.refresh();
                                    }}
                                  >
                                    删除
                                  </ActionButton>
                                </div>
                              )}
                            </article>
                          );
                        })}
                        {!records(comments.data).length && <Empty>暂无评论</Empty>}
                      </div>
                    </ResultState>
                  </>
                ) : (
                  <ResultState loading={activities.loading} error={activities.error}>
                    <div className="v6-activity-list">
                      {records(activities.data)
                        .slice()
                        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022-compatible immutable ordering
                        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
                        .map((activity) => (
                          <article className="px-activity-row" key={activity.id}>
                            <span className="px-avatar">
                              {userName(activity.actor_detail as Session["user"] | undefined).slice(0, 1)}
                            </span>
                            <div>
                              <p>
                                <strong>{userName(activity.actor_detail as Session["user"] | undefined)}</strong>{" "}
                                {fieldNames[String(activity.field)]
                                  ? `更新${fieldNames[String(activity.field)]}`
                                  : activity.verb === "created"
                                    ? "创建任务"
                                    : "更新任务"}
                                {activity.new_value && !/^[a-f0-9-]{36}$/.test(String(activity.new_value))
                                  ? ` · ${String(activity.new_value)}`
                                  : ""}
                              </p>
                              <time>{dateLabel(activity.created_at)}</time>
                            </div>
                          </article>
                        ))}
                      {!records(activities.data).length && <Empty>暂无动态</Empty>}
                    </div>
                  </ResultState>
                )}
              </section>
              <details className="v6-secondary-details px-detail-more">
                <summary>
                  任务属性与更多操作
                  <CanonicalIcon name="chevron" size={17} />
                </summary>
                <DetailFields
                  values={[
                    ["开始日期", dateLabel(task.start_date)],
                    ["截止日期", dateLabel(task.target_date)],
                    [
                      "周期",
                      <button key="cycle" className="chip" disabled={!canEdit} onClick={() => setModal("cycle")}>
                        {String(taskCycle?.name ?? "未设置")}
                      </button>,
                    ],
                    [
                      "模块",
                      <button key="modules" className="chip" disabled={!canEdit} onClick={() => setModal("modules")}>
                        {taskModules}
                      </button>,
                    ],
                    [
                      "父任务",
                      task.parent_id ? (
                        <button
                          key="parent"
                          className="chip"
                          onClick={() => onNavigate({ page: "issue", projectId, issueId: String(task.parent_id) })}
                        >
                          查看父任务
                        </button>
                      ) : (
                        "无"
                      ),
                    ],
                  ]}
                />
                <div className="core-section-heading">
                  <h2>描述</h2>
                  <button className="chip" onClick={() => setModal("versions")}>
                    历史版本
                  </button>
                  {canEdit && (
                    <button className="chip" onClick={() => setModal("description")}>
                      编辑
                    </button>
                  )}
                </div>
                <TaskDocuments
                  store={lab}
                  projectId={projectId}
                  issueId={issueId}
                  onOpenDocument={(targetProject, page) =>
                    onNavigate({ page: "document", projectId: targetProject, pageId: page })
                  }
                />
                <div className="core-section-heading">
                  <h2>
                    子任务 <span className="muted">{childRows.length}</span>
                  </h2>
                  {canEdit && (
                    <button className="chip" onClick={() => setModal("child")}>
                      <Plus size={15} />
                      新建
                    </button>
                  )}
                </div>
                <div className="list">
                  {childRows.map((child) => (
                    <div key={child.id}>
                      <TaskCard
                        task={child}
                        project={project.data}
                        states={stateRows}
                        members={members.data}
                        onOpen={() => openTask(child)}
                      />
                      {canEdit && (
                        <ActionButton
                          className="chip"
                          action={() => client.request(service.taskPath(child.id), "PATCH", { parent_id: null })}
                          onDone={() => {
                            void children.refresh();
                          }}
                        >
                          解除关联
                        </ActionButton>
                      )}
                    </div>
                  ))}
                  {!childRows.length && <Empty>暂无子任务</Empty>}
                </div>
                {canEdit && (
                  <button className="chip" onClick={() => setModal("search-child")}>
                    关联已有任务
                  </button>
                )}
                <div className="core-section-heading">
                  <h2>相关任务</h2>
                  {canEdit && (
                    <button className="chip" onClick={() => setModal("relation-kind")}>
                      <Link2 size={15} />
                      添加
                    </button>
                  )}
                </div>
                <ErrorMessage error={relations.error} />
                <div className="list">
                  {relationRows.map((row) => (
                    <article className="card" key={`${row.relationKey}-${row.id}`}>
                      <span className="chip">{relationNames[row.relationKey] ?? "相关"}</span>
                      <button className="core-task-name" onClick={() => openTask(row)}>
                        {row.name}
                      </button>
                      {canEdit && (
                        <ActionButton
                          className="chip"
                          action={() => service.unrelate(issueId, row.id)}
                          onDone={() => {
                            void relations.refresh();
                          }}
                        >
                          解除关联
                        </ActionButton>
                      )}
                    </article>
                  ))}
                  {!relationRows.length && <Empty>暂无相关任务</Empty>}
                </div>
                <div className="core-section-heading">
                  <h2>链接</h2>
                  {canEdit && (
                    <button className="chip" onClick={() => setModal("link")}>
                      <Plus size={15} />
                      添加
                    </button>
                  )}
                </div>
                <ErrorMessage error={links.error} />
                <div className="list">
                  {records(links.data).map((link) => (
                    <article className="card" key={link.id}>
                      <a
                        href={/^https?:\/\//.test(String(link.url)) ? String(link.url) : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {String(link.title || link.url)}
                      </a>
                      {canEdit && (
                        <div className="core-card-actions">
                          <button
                            className="chip"
                            onClick={() => {
                              setSelected(link);
                              setModal("link");
                            }}
                          >
                            编辑
                          </button>
                          <ActionButton
                            className="chip"
                            action={() => client.request(`${path}issue-links/${link.id}/`, "DELETE")}
                            onDone={() => {
                              void links.refresh();
                            }}
                          >
                            删除
                          </ActionButton>
                        </div>
                      )}
                    </article>
                  ))}
                  {!records(links.data).length && <Empty>暂无链接</Empty>}
                </div>
                <div className="core-section-heading">
                  <h2>附件</h2>
                  {canEdit && (
                    <ActionButton
                      className="chip"
                      action={() => client.uploadAttachment(workspaceSlug, projectId, issueId)}
                      onDone={() => {
                        void attachments.refresh();
                      }}
                    >
                      <Paperclip size={15} />
                      上传
                    </ActionButton>
                  )}
                </div>
                <ErrorMessage error={attachments.error} />
                <div className="list">
                  {records(attachments.data).map((file) => {
                    const attributes = file.attributes as Entity | undefined;
                    return (
                      <article className="card" key={file.id}>
                        <div className="core-file-row">
                          <Paperclip size={20} />
                          <span>
                            {String(attributes?.name || "附件")}
                            <small className="muted">
                              {attributes?.size ? ` · ${Math.ceil(Number(attributes.size) / 1024)} KB` : ""}
                            </small>
                          </span>
                          <ActionButton
                            className="chip"
                            action={() =>
                              client.download(`${attachmentPath}${file.id}/`, String(attributes?.name ?? "附件"))
                            }
                          >
                            下载
                          </ActionButton>
                        </div>
                        {(canAdmin || file.created_by === myId) && (
                          <ActionButton
                            className="chip"
                            action={() => client.request(`${attachmentPath}${file.id}/`, "DELETE")}
                            onDone={() => {
                              void attachments.refresh();
                            }}
                          >
                            删除
                          </ActionButton>
                        )}
                      </article>
                    );
                  })}
                  {!records(attachments.data).length && <Empty>暂无附件</Empty>}
                </div>
              </details>
              <div className="px-comment-row">
                <button
                  className="px-comment"
                  disabled={Boolean(task.archived_at)}
                  onClick={() => setModal("new-comment")}
                >
                  <CanonicalIcon name="comment" size={20} />
                  添加评论
                </button>
                {canEdit && (
                  <ActionButton
                    className="px-attachment"
                    action={() => client.uploadAttachment(workspaceSlug, projectId, issueId)}
                    onDone={() => {
                      void attachments.refresh();
                    }}
                  >
                    <CanonicalIcon name="plus" size={24} />
                    <span className="sr-only">添加任务附件</span>
                  </ActionButton>
                )}
              </div>
            </main>
            <ErrorMessage error={project.error ?? states.error ?? labels.error ?? members.error ?? children.error} />
          </>
        )}
      </ResultState>
      {modal === "new-comment" && task && (
        <Sheet title="添加评论" onClose={close}>
          {" "}
          {!task.archived_at && (
            <div className="card core-inline-form">
              <RichHtmlEditor value={commentText} onChange={setCommentText} />
              <ActionButton
                className="button primary"
                action={async () => {
                  if (!plainText(commentText).trim() && !/<(?:img|table)/i.test(commentText))
                    throw new Error("请填写评论");
                  await service.comment(issueId, commentText);
                  setCommentText("");
                  await comments.refresh();
                  close();
                }}
              >
                发送
              </ActionButton>
            </div>
          )}
        </Sheet>
      )}
      {modal === "activity-filter" && (
        <Sheet title="活动" onClose={close}>
          <div className="core-rows">
            {[
              ["activity", "活动"],
              ["comments", "评论"],
            ].map(([key, name]) => (
              <button
                className="row"
                key={key}
                onClick={() => {
                  setTab(key);
                  close();
                }}
              >
                <span className="row-main">{name}</span>
                {tab === key && <CanonicalIcon name="check" size={19} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {modal === "state" && task && (
        <StateSelector
          states={stateRows}
          selected={task.state_id}
          issueKey={task.sequence_id ? `${String(project.data?.identifier ?? "任务")}-${task.sequence_id}` : "任务详情"}
          onClose={close}
          onSelect={async (stateId) => {
            await client.request(path, "PATCH", { state_id: stateId });
            await refresh();
            close();
          }}
        />
      )}
      {modal === "edit" && task && (
        <TaskForm service={service} task={task} states={stateRows} onDone={refresh} onClose={close} />
      )}
      {modal === "owners" && task && (
        <MultiSelectSheet
          title="负责人"
          options={(members.data ?? [])
            .filter((row) => row.is_active !== false)
            .map((row) => ({ id: row.member.id, name: userName(row.member) }))}
          selected={task.assignee_ids ?? []}
          onSave={async (ids) => {
            await client.request(path, "PATCH", { assignee_ids: ids });
            await refresh();
          }}
          onClose={close}
        />
      )}
      {modal === "labels" && task && (
        <MultiSelectSheet
          title="标签"
          options={labelRows.map((row) => ({ id: String(row.id), name: String(row.name) }))}
          selected={task.label_ids ?? []}
          onSave={async (ids) => {
            await client.request(path, "PATCH", { label_ids: ids });
            await refresh();
          }}
          onClose={close}
        />
      )}
      {modal === "modules" && task && (
        <MultiSelectSheet
          title="模块"
          options={moduleRows.map((row) => ({ id: String(row.id), name: String(row.name) }))}
          selected={task.module_ids ?? []}
          onSave={async (ids) => {
            await client.request(`${path}modules/`, "POST", {
              modules: ids.filter((id) => !task.module_ids?.includes(id)),
              removed_modules: task.module_ids?.filter((id) => !ids.includes(id)) ?? [],
            });
            await refresh();
          }}
          onClose={close}
        />
      )}
      {modal === "cycle" && task && (
        <FormSheet
          title="周期"
          fields={[
            {
              key: "cycle",
              label: "周期",
              type: "select",
              value: task.cycle_id,
              options: [
                { value: "none", label: "无周期" },
                ...cycleRows.map((row) => ({ value: String(row.id), label: String(row.name) })),
              ],
            },
          ]}
          onClose={close}
          onSubmit={async (values) => {
            if (!values.cycle || values.cycle === "none") {
              if (task.cycle_id)
                await client.request(
                  `${service.projectPath}/cycles/${task.cycle_id}/cycle-issues/${issueId}/`,
                  "DELETE"
                );
            } else if (values.cycle !== task.cycle_id)
              await client.request(`${service.projectPath}/cycles/${values.cycle}/cycle-issues/`, "POST", {
                issues: [issueId],
              });
            await refresh();
          }}
        />
      )}
      {modal === "versions" && task && (
        <DescriptionVersions
          service={service}
          issueId={issueId}
          canEdit={canEdit}
          onClose={close}
          onRestore={refresh}
        />
      )}
      {modal === "description" && task && (
        <FormSheet
          title="编辑描述"
          fields={[{ key: "description", label: "描述", type: "rich", value: task.description_html }]}
          onClose={close}
          onSubmit={async (values) => {
            await service.saveDescription(issueId, values.description);
            await refresh();
          }}
        />
      )}
      {modal === "comment" && selected && (
        <FormSheet
          title="编辑评论"
          fields={[
            {
              key: "comment",
              label: "评论",
              type: "rich",
              value: String(selected.comment_html ?? ""),
              required: true,
            },
          ]}
          onClose={close}
          onSubmit={async (values) => {
            await service.comment(issueId, values.comment, String(selected.id));
            await comments.refresh();
          }}
        />
      )}
      {modal === "link" && (
        <FormSheet
          title={selected ? "编辑链接" : "添加链接"}
          fields={[
            { key: "title", label: "标题", value: selected?.title },
            { key: "url", label: "网址", type: "url", value: selected?.url, required: true },
          ]}
          onClose={close}
          onSubmit={async (values) => {
            await client.request(
              `${path}issue-links/${selected ? `${selected.id}/` : ""}`,
              selected ? "PATCH" : "POST",
              values
            );
            await links.refresh();
          }}
        />
      )}
      {modal === "child" && (
        <TaskForm
          service={service}
          states={stateRows}
          members={members.data}
          labels={labelRows}
          parentId={issueId}
          onDone={refresh}
          onClose={close}
        />
      )}
      {modal === "search-child" && (
        <TaskSearchSheet
          client={client}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          title="关联子任务"
          exclude={[issueId, ...childRows.map((row) => row.id)]}
          onClose={close}
          onSelect={async (row) => {
            await client.request(service.taskPath(String(row.id)), "PATCH", { parent_id: issueId });
            await children.refresh();
          }}
        />
      )}
      {modal === "relation-kind" && (
        <Sheet title="添加任务关系" onClose={close}>
          <div className="list">
            {Object.entries(relationNames).map(([key, label]) => (
              <button
                className="button"
                key={key}
                onClick={() => {
                  setRelationType(key);
                  setModal("relation");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {modal === "relation" && (
        <TaskSearchSheet
          client={client}
          workspaceSlug={workspaceSlug}
          title={relationNames[relationType]}
          exclude={[issueId, ...relationRows.map((row) => row.id)]}
          onClose={close}
          onSelect={async (row) => {
            await service.relate(issueId, String(row.id), relationType);
            await relations.refresh();
          }}
        />
      )}
      {modal === "parent" && (
        <TaskSearchSheet
          client={client}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          title="设置父任务"
          exclude={[issueId, ...childRows.map((row) => row.id)]}
          onClose={close}
          onSelect={async (row) => {
            await client.request(path, "PATCH", { parent_id: row.id });
            await refresh();
          }}
        />
      )}
      {modal === "actions" && task && (
        <Sheet title="任务操作" onClose={close}>
          <div className="list">
            {canEdit && (
              <>
                <button className="button" onClick={() => setModal("edit")}>
                  编辑属性
                </button>
                <button className="button" onClick={() => setModal("parent")}>
                  设置父任务
                </button>
                {task.parent_id && (
                  <ActionButton
                    action={() => client.request(path, "PATCH", { parent_id: null })}
                    onDone={() => {
                      close();
                      void refresh();
                    }}
                  >
                    移除父任务
                  </ActionButton>
                )}
              </>
            )}
            <ActionButton
              action={() => client.request(`${path}subscribe/`, task.is_subscribed ? "DELETE" : "POST")}
              onDone={() => {
                close();
                void detail.refresh();
              }}
            >
              <Bell size={17} />
              {task.is_subscribed ? "取消关注" : "关注任务"}
            </ActionButton>
            {(role >= 15 || canAdmin) &&
              (task.archived_at || ["completed", "cancelled"].includes(String(state?.group))) && (
                <ActionButton
                  action={() => client.request(`${path}archive/`, task.archived_at ? "DELETE" : "POST")}
                  onDone={() => {
                    close();
                    void refresh();
                  }}
                >
                  {task.archived_at ? "取消归档" : "归档任务"}
                </ActionButton>
              )}
            {canEdit && (
              <button className="button danger" onClick={() => setModal("delete")}>
                删除任务
              </button>
            )}
          </div>
        </Sheet>
      )}
      {modal === "delete" && task && (
        <FormSheet
          title="删除任务"
          fields={[
            { key: "reason", label: "删除原因", type: "textarea", required: true },
            { key: "confirmation", label: `输入「${task.name}」确认删除`, required: true },
          ]}
          onClose={close}
          onSubmit={async (values) => {
            if (values.confirmation !== task.name) throw new Error("任务标题不一致");
            await service.deleteTask(issueId, values.reason);
            onNavigate({ page: "tasks", projectId });
          }}
        />
      )}
    </>
  );
}

function IssueDescription({ html }: { html?: string }) {
  const parts = useMemo(() => {
    if (!html) return { first: "", rest: "" };
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root =
      doc.body.children.length === 1 && doc.body.firstElementChild?.tagName === "DIV"
        ? doc.body.firstElementChild
        : doc.body;
    const nodes = [...root.childNodes].filter(
      (node) => node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim()
    );
    const markup = (node: ChildNode) => {
      const box = doc.createElement("div");
      box.append(node.cloneNode(true));
      return box.innerHTML;
    };
    return { first: nodes[0] ? markup(nodes[0]) : html, rest: nodes.slice(1).map(markup).join("") };
  }, [html]);
  return (
    <div className="px-issue-description v6-issue-description">
      {parts.first ? <Html html={parts.first} /> : <p>暂无描述</p>}
      {parts.rest && (
        <details className="core-description-more">
          <summary>
            查看完整描述
            <CanonicalIcon name="down" size={13} />
          </summary>
          <Html html={parts.rest} />
        </details>
      )}
    </div>
  );
}
function StateSelector({
  states,
  selected,
  issueKey,
  onSelect,
  onClose,
}: {
  states: Entity[];
  selected?: string;
  issueKey: string;
  onSelect: (id: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Sheet title="任务状态" subtitle={issueKey} className="px-state-sheet v6-state-sheet" onClose={onClose} busy={busy}>
      <label className="px-state-search">
        <CanonicalIcon name="search" size={21} />
        <input
          type="search"
          aria-label="搜索状态"
          placeholder="搜索状态"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="px-state-options" role="radiogroup" aria-label="选择任务状态">
        {states
          .filter((state) => String(state.name).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((state) => (
            <button
              className={`px-state-option ${state.id === selected ? "px-state-selected" : ""}`}
              key={state.id}
              role="radio"
              aria-checked={state.id === selected}
              disabled={busy}
              onClick={async () => {
                if (state.id === selected) {
                  onClose();
                  return;
                }
                setBusy(true);
                setError(undefined);
                try {
                  await onSelect(String(state.id));
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span>
                <V6StateMark state={state} />
                {String(state.name)}
              </span>
              <i className={`px-radio ${state.id === selected ? "px-radio-checked" : ""}`} />
            </button>
          ))}
      </div>
      <ErrorMessage error={error} />
    </Sheet>
  );
}
