import { useState } from "react";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Html,
  PageHeading,
  Sheet,
  useData,
  records,
  type Entity,
} from "../../components/ui";
import { AddButton, DetailFields, Empty, ProjectPicker, ResultState, TaskSearchSheet } from "./shared";
import { priorities, priorityName, userName, type Member, type CoreProps, type Session, type Task } from "./model";
type IntakeRow = Entity & {
  id: string;
  status: number;
  issue: Task;
  duplicate_to?: string | null;
  snoozed_till?: string | null;
  created_by?: string;
};
const statuses = [
  { value: "-2", label: "待审批" },
  { value: "-1", label: "已拒绝" },
  { value: "0", label: "稍后处理" },
  { value: "1", label: "已接受" },
  { value: "2", label: "重复" },
];
export default function Intake(props: CoreProps) {
  if (!props.projectId)
    return (
      <>
        <PageHeading title="需求收件箱" />
        <ProjectPicker {...props} section="intake" />
      </>
    );
  return <ProjectIntake {...props} projectId={props.projectId} />;
}
function ProjectIntake(props: CoreProps & { projectId: string }) {
  const { client, workspaceSlug, projectId, onNavigate } = props;
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${projectId}`;
  const project = useData<Entity>(client, `${base}/`);
  const session = useData<Session>(client, "/api/lab/session/");
  const [status, setStatus] = useState("-2"),
    [cursors, setCursors] = useState([""]),
    [selected, setSelected] = useState<string>(),
    [modal, setModal] = useState<string>();
  const cursor = cursors[cursors.length - 1];
  const list = useData<Entity>(
    client,
    `${base}/intake-issues/?status=${status}&per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
  );
  const detail = useData<IntakeRow>(client, selected ? `${base}/intake-issues/${selected}/` : null);
  const comments = useData<Entity[]>(client, selected ? `${base}/issues/${selected}/comments/` : null);
  const members = useData<Member[]>(client, `${base}/members/`),
    labels = useData<Entity[]>(client, `${base}/issue-labels/`);
  const row = detail.data;
  const notEnabled = Boolean(
    list.error && typeof list.error === "object" && "status" in list.error && list.error.status === 404
  );
  const enableIntake = async () => {
    const intake = await client.request<Entity>(`${base}/intakes/`);
    if (!intake.id) await client.request(`${base}/intakes/`, "POST", { name: "需求收集", is_default: true });
    await list.refresh();
  };
  const isAdmin = Number(project.data?.member_role) >= 20;
  const canEdit =
    isAdmin ||
    Boolean(row && (row.issue.created_by === session.data?.user.id || row.created_by === session.data?.user.id));
  const mutate = async (body: Entity) => {
    await client.request(`${base}/intake-issues/${selected}/`, "PATCH", body);
    await Promise.all([list.refresh(), detail.refresh()]);
  };
  return (
    <>
      <PageHeading title="需求收件箱">
        {Number(project.data?.member_role) >= 5 && !notEnabled && (
          <AddButton onClick={() => setModal("create")}>提交需求</AddButton>
        )}
      </PageHeading>
      <div className="core-tabs">
        {statuses.map((value) => (
          <button
            key={value.value}
            className={`chip ${status === value.value ? "active" : ""}`}
            onClick={() => {
              setStatus(value.value);
              setCursors([""]);
            }}
          >
            {value.label}
          </button>
        ))}
      </div>
      {notEnabled && (
        <div className="card">
          <p>此项目尚未启用需求收集。</p>
          {Number(project.data?.member_role) >= 15 && (
            <ActionButton className="button primary" action={enableIntake}>
              启用需求收集
            </ActionButton>
          )}
        </div>
      )}
      <ResultState loading={list.loading} error={notEnabled ? undefined : list.error}>
        <div className="list">
          {records(list.data).map((item) => {
            const itemRow = item as IntakeRow;
            return (
              <button key={itemRow.id} className="card core-select-task" onClick={() => setSelected(itemRow.issue.id)}>
                <strong>{itemRow.issue.name}</strong>
                <span className="muted">优先级 · {priorityName(itemRow.issue.priority)}</span>
              </button>
            );
          })}
          {!records(list.data).length && <Empty>暂无需求</Empty>}
        </div>
      </ResultState>
      <div className="core-pager">
        <button className="button" disabled={cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))}>
          上一页
        </button>
        <span>第{cursors.length}页</span>
        <button
          className="button"
          disabled={!list.data?.next_page_results}
          onClick={() => setCursors([...cursors, String(list.data?.next_cursor)])}
        >
          下一页
        </button>
      </div>
      <ErrorMessage error={project.error ?? session.error} />
      {selected && (
        <Sheet
          title="需求详情"
          onClose={() => {
            setSelected(undefined);
            setModal(undefined);
          }}
        >
          <ResultState loading={detail.loading} error={detail.error}>
            {row && (
              <>
                <h2>{row.issue.name}</h2>
                <DetailFields
                  values={[
                    ["审批状态", statuses.find((item) => Number(item.value) === row.status)?.label ?? "未知"],
                    ["优先级", priorityName(row.issue.priority)],
                    ["稍后处理", row.snoozed_till ? new Date(row.snoozed_till).toLocaleString("zh-CN") : "未设置"],
                  ]}
                />
                <Html html={row.issue.description_html} />
                <DetailFields
                  values={[
                    [
                      "负责人",
                      row.issue.assignee_ids
                        ?.map((id) => userName(members.data?.find((member) => member.member.id === id)?.member))
                        .join("、") || "未分配",
                    ],
                    [
                      "标签",
                      records(labels.data)
                        .filter((label) => row.issue.label_ids?.includes(String(label.id)))
                        .map((label) => String(label.name))
                        .join("、") || "无标签",
                    ],
                  ]}
                />
                <h3>评论</h3>
                <ResultState loading={comments.loading} error={comments.error}>
                  <div className="list">
                    {records(comments.data).map((comment) => (
                      <article className="card" key={comment.id}>
                        <strong>{userName(comment.actor_detail as Session["user"] | undefined)}</strong>
                        <Html html={comment.comment_html} />
                      </article>
                    ))}
                  </div>
                </ResultState>
                <button className="button" onClick={() => setModal("comment")}>
                  发表评论
                </button>
                <div className="core-tabs">
                  {canEdit && (
                    <button className="button" onClick={() => setModal("edit")}>
                      编辑需求
                    </button>
                  )}
                  {row.status === 1 && (
                    <button
                      className="button"
                      onClick={() => onNavigate({ page: "issue", projectId, issueId: row.issue.id })}
                    >
                      打开任务
                    </button>
                  )}
                  {row.duplicate_to && (
                    <button
                      className="button"
                      onClick={() => onNavigate({ page: "issue", projectId, issueId: String(row.duplicate_to) })}
                    >
                      查看重复任务
                    </button>
                  )}
                  {isAdmin && (
                    <>
                      <ActionButton
                        className="button primary"
                        action={() => mutate({ status: 1, snoozed_till: null, duplicate_to: null })}
                      >
                        接受
                      </ActionButton>
                      <ActionButton className="button" action={() => mutate({ status: -1 })}>
                        拒绝
                      </ActionButton>
                      <button className="button" onClick={() => setModal("snooze")}>
                        稍后处理
                      </button>
                      <button className="button" onClick={() => setModal("duplicate")}>
                        标记重复
                      </button>
                      <ActionButton
                        className="button"
                        action={() => mutate({ status: -2, snoozed_till: null, duplicate_to: null })}
                      >
                        重新待审批
                      </ActionButton>
                    </>
                  )}
                  {canEdit && (
                    <button className="button danger" onClick={() => setModal("delete")}>
                      删除需求
                    </button>
                  )}
                </div>
              </>
            )}
          </ResultState>
        </Sheet>
      )}
      {modal === "comment" && selected && (
        <FormSheet
          title="发表评论"
          fields={[{ key: "comment", label: "评论", type: "rich", required: true }]}
          onClose={() => setModal(undefined)}
          onSubmit={async (values) => {
            await client.request(`${base}/issues/${selected}/comments/`, "POST", { comment_html: values.comment });
            await comments.refresh();
          }}
        />
      )}
      {(modal === "create" || modal === "edit") && (
        <FormSheet
          title={modal === "create" ? "提交需求" : "编辑需求"}
          fields={[
            { key: "name", label: "标题", required: true, value: modal === "edit" ? row?.issue.name : "" },
            {
              key: "priority",
              label: "优先级",
              type: "select",
              options: priorities,
              value: modal === "edit" ? row?.issue.priority : "none",
            },
            ...(modal === "create" || Number(project.data?.member_role) >= 15
              ? [
                  {
                    key: "assignee",
                    label: "负责人",
                    type: "select" as const,
                    value: modal === "edit" ? row?.issue.assignee_ids?.[0] : "",
                    options: (members.data ?? [])
                      .filter((member) => member.role >= 15)
                      .map((member) => ({ value: member.member.id, label: userName(member.member) })),
                  },
                  {
                    key: "label",
                    label: "标签",
                    type: "select" as const,
                    value: modal === "edit" ? row?.issue.label_ids?.[0] : "",
                    options: records(labels.data).map((label) => ({
                      value: String(label.id),
                      label: String(label.name),
                    })),
                  },
                ]
              : []),
            {
              key: "description",
              label: "描述",
              type: "rich",
              value: modal === "edit" ? row?.issue.description_html : "",
            },
          ]}
          onClose={() => setModal(undefined)}
          onSubmit={async (values) => {
            if (modal === "create" && Number(project.data?.member_role) >= 15) await enableIntake();
            const body = {
              issue: {
                name: values.name,
                priority: values.priority,
                description_html: values.description,
                ...(values.assignee !== undefined &&
                (modal === "create" || values.assignee !== (row?.issue.assignee_ids?.[0] ?? ""))
                  ? { assignee_ids: values.assignee ? [values.assignee] : [] }
                  : {}),
                ...(values.label !== undefined &&
                (modal === "create" || values.label !== (row?.issue.label_ids?.[0] ?? ""))
                  ? { label_ids: values.label ? [values.label] : [] }
                  : {}),
              },
            };
            if (modal === "edit") await mutate(body);
            else {
              const next = await client.request<IntakeRow>(`${base}/intake-issues/`, "POST", body);
              await list.refresh();
              setSelected(next.issue.id);
            }
          }}
        />
      )}
      {modal === "snooze" && (
        <FormSheet
          title="稍后处理"
          fields={[{ key: "until", label: "处理时间", type: "datetime-local", required: true }]}
          onClose={() => setModal(undefined)}
          onSubmit={async (values) => {
            const date = new Date(values.until);
            if (date.getTime() <= Date.now()) throw new Error("请选择未来的时间");
            await mutate({ status: 0, snoozed_till: date.toISOString() });
          }}
        />
      )}
      {modal === "duplicate" && (
        <TaskSearchSheet
          client={client}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          title="重复任务"
          exclude={selected ? [selected] : []}
          onClose={() => setModal(undefined)}
          onSelect={async (task) => {
            await mutate({ status: 2, duplicate_to: task.id });
            setModal(undefined);
          }}
        />
      )}
      {modal === "delete" && row && (
        <FormSheet
          title="删除需求"
          fields={[{ key: "confirm", label: `输入“${row.issue.name}”确认`, required: true }]}
          onClose={() => setModal(undefined)}
          onSubmit={async (values) => {
            if (values.confirm !== row.issue.name) throw new Error("确认名称不一致");
            await client.request(`${base}/intake-issues/${selected}/`, "DELETE");
            setSelected(undefined);
            await list.refresh();
          }}
        />
      )}
    </>
  );
}
