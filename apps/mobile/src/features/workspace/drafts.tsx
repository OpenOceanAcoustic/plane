import { PageHeading } from "../../components/ui";
import { useMemo, useState } from "react";
import { ErrorMessage, Html, records, useData, type Entity } from "../../components/ui";
import { RichHtmlEditor } from "../../components/rich-editor";
import { priorities, userName, type Member } from "../core/model";
import { Button, LabDialog, LabField, labInputClass } from "../lab/ui";
import { WorkspaceService, type Draft, type Page, type WorkspaceProps } from "./business";
import { Pagination, Status, useWorkspace } from "./shared";
export default function Drafts(props: WorkspaceProps) {
  const { base, role, projects } = useWorkspace(props),
    service = useMemo(
      () => new WorkspaceService(props.client, props.workspaceSlug),
      [props.client, props.workspaceSlug]
    );
  const [cursor, setCursor] = useState(""),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState<"create" | "edit" | "delete" | "publish">(),
    [selected, setSelected] = useState<Draft>();
  const page = useData<Page<Draft>>(
    props.client,
    `${base}/draft-issues/?per_page=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
  );
  const detail = useData<Draft>(props.client, selected ? `${base}/draft-issues/${selected.id}/` : null),
    row = detail.data ?? selected;
  const visible = (page.data?.results ?? []).filter((draft) =>
    draft.name?.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );
  const edit = modal === "create" || modal === "edit";
  return (
    <>
      <PageHeading title="草稿">
        {role >= 5 && (
          <Button
            variant="primary"
            onClick={() => {
              setSelected(undefined);
              setModal("create");
            }}
          >
            新建草稿
          </Button>
        )}
      </PageHeading>
      <LabField label="搜索草稿">
        <input
          className={labInputClass}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="任务名称"
        />
      </LabField>
      <Status loading={page.loading} error={page.error} empty={!visible.length} />
      <div className="lab-list">
        {visible.map((draft) => (
          <article className="lab-card" key={draft.id}>
            <button
              className="record-title"
              onClick={() => {
                setSelected(draft);
                setModal("edit");
              }}
            >
              {draft.name || "未命名草稿"}
            </button>
            <p className="lab-muted">
              {projects.data?.find((project) => project.id === draft.project_id)?.name ?? "未选择项目"} ·{" "}
              {priorities.find((priority) => priority.value === draft.priority)?.label ?? "无优先级"}
            </p>
            <div className="lab-actions">
              <Button
                onClick={() => {
                  setSelected(draft);
                  setModal("edit");
                }}
              >
                编辑
              </Button>
              {role >= 15 && (
                <Button
                  onClick={() => {
                    setSelected(draft);
                    setModal("publish");
                  }}
                >
                  发布为任务
                </Button>
              )}
              <Button
                onClick={() => {
                  setSelected(draft);
                  setModal("delete");
                }}
              >
                删除
              </Button>
            </div>
          </article>
        ))}
      </div>
      <Pagination page={page.data} onChange={setCursor} />
      {edit && modal === "edit" && !detail.data && (
        <LabDialog title="读取草稿" onClose={() => setModal(undefined)}>
          <Status loading={detail.loading} error={detail.error} />
        </LabDialog>
      )}
      {edit && (modal === "create" || !!detail.data) && (
        <DraftEditor
          key={`${modal}:${selected?.id ?? "new"}`}
          {...props}
          initial={modal === "edit" ? row : undefined}
          loading={modal === "edit" && detail.loading}
          loadError={detail.error}
          onClose={() => setModal(undefined)}
          onSaved={async () => {
            await page.refresh();
            setModal(undefined);
          }}
        />
      )}
      {modal === "delete" && row && (
        <LabDialog
          title="删除草稿"
          destructive
          submitLabel="删除草稿"
          onClose={() => setModal(undefined)}
          onSubmit={async () => {
            await props.client.request(`${base}/draft-issues/${row.id}/`, "DELETE");
            await page.refresh();
            setModal(undefined);
          }}
        >
          <p>删除“{row.name}”及其草稿资料？</p>
        </LabDialog>
      )}
      {modal === "publish" && row && (
        <LabDialog
          title="发布为任务"
          submitLabel="确认发布"
          submitDisabled={!row.project_id || detail.loading || !!detail.error}
          onClose={() => setModal(undefined)}
          onSubmit={async () => {
            const task = await service.publishDraft(row.id);
            await page.refresh();
            setModal(undefined);
            props.onNavigate({ page: "issue", projectId: row.project_id, issueId: task.id });
          }}
        >
          <ErrorMessage error={detail.error} />
          <p>发布“{row.name}”？</p>
          {!row.project_id && <p className="error">请先编辑草稿并选择项目。</p>}
          <Html html={row.description_html} />
        </LabDialog>
      )}
    </>
  );
}
function ChoiceList({
  label,
  name,
  rows,
  initial = [],
}: {
  label: string;
  name: string;
  rows: { id: string; name: string }[];
  initial?: string[];
}) {
  return (
    <details className="workspace-choices">
      <summary>{label}</summary>
      {rows.length ? (
        rows.map((row) => (
          <label key={row.id}>
            <input type="checkbox" name={name} value={row.id} defaultChecked={initial.includes(row.id)} />
            {row.name}
          </label>
        ))
      ) : (
        <p className="lab-muted">暂无可选记录</p>
      )}
    </details>
  );
}
function DraftEditor(
  props: WorkspaceProps & {
    initial?: Draft;
    loading: boolean;
    loadError: unknown;
    onClose: () => void;
    onSaved: () => Promise<void>;
  }
) {
  const { initial, loading, loadError, onClose, onSaved, client } = props,
    { base, projects } = useWorkspace(props);
  const [project, setProject] = useState(initial?.project_id ?? ""),
    [html, setHtml] = useState(initial?.description_html ?? ""),
    [parentSearch, setParentSearch] = useState(""),
    [stateId, setStateId] = useState(initial?.state_id ?? ""),
    [cycleId, setCycleId] = useState(initial?.cycle_id ?? ""),
    [parentId, setParentId] = useState(String(initial?.parent_id ?? ""));
  const prefix = project ? `${base}/projects/${project}` : null;
  const states = useData<Entity[]>(client, prefix ? `${prefix}/states/` : null),
    members = useData<Member[]>(client, prefix ? `${prefix}/members/` : null),
    labels = useData<Entity[]>(client, prefix ? `${prefix}/issue-labels/` : null),
    cycles = useData<Entity[]>(client, prefix ? `${prefix}/cycles/` : null),
    modules = useData<Entity[]>(client, prefix ? `${prefix}/modules/` : null);
  const tasks = useData(client, prefix ? `${prefix}/search-issues/?search=${encodeURIComponent(parentSearch)}` : null);
  const sameProject = project === initial?.project_id;
  return (
    <LabDialog
      title={initial ? "编辑草稿" : "新建草稿"}
      onClose={onClose}
      busy={loading}
      submitDisabled={
        !!loadError ||
        (!!project &&
          (states.loading ||
            members.loading ||
            labels.loading ||
            cycles.loading ||
            modules.loading ||
            !!states.error ||
            !!members.error ||
            !!labels.error ||
            !!cycles.error ||
            !!modules.error))
      }
      onSubmit={async (data) => {
        const start = String(data.get("start_date") ?? ""),
          end = String(data.get("target_date") ?? "");
        if (start && end && start > end) throw new Error("开始日期不能晚于截止日期");
        const body: Record<string, unknown> = {
          name: String(data.get("name") ?? "").trim(),
          project_id: project || null,
          description_html: html,
          priority: data.get("priority") || "none",
          start_date: start || null,
          target_date: end || null,
        };
        if (project) {
          body.state_id = data.get("state_id") || null;
          body.assignee_ids = data.getAll("assignee_ids");
          body.label_ids = data.getAll("label_ids");
          body.cycle_id = data.get("cycle_id") || null;
          body.module_ids = data.getAll("module_ids");
          body.parent_id = data.get("parent_id") || null;
        }
        await client.request(
          `${base}/draft-issues/${initial ? `${initial.id}/` : ""}`,
          initial ? "PATCH" : "POST",
          body
        );
        await onSaved();
      }}
    >
      <ErrorMessage error={loadError} />
      <LabField label="任务名称">
        <input className={labInputClass} name="name" defaultValue={initial?.name ?? ""} required maxLength={255} />
      </LabField>
      <LabField label="项目">
        <select
          className={labInputClass}
          value={project}
          onChange={(event) => {
            setProject(event.target.value);
            setStateId("");
            setCycleId("");
            setParentId("");
          }}
        >
          <option value="">稍后选择项目</option>
          {projects.data?.map((row) => (
            <option value={row.id} key={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </LabField>
      <LabField label="描述">
        <RichHtmlEditor value={html} onChange={setHtml} />
      </LabField>
      <LabField label="优先级">
        <select className={labInputClass} name="priority" defaultValue={initial?.priority ?? "none"}>
          {priorities.map((priority) => (
            <option key={priority.value} value={priority.value}>
              {priority.label}
            </option>
          ))}
        </select>
      </LabField>
      <LabField label="开始日期">
        <input
          className={labInputClass}
          type="date"
          name="start_date"
          defaultValue={String(initial?.start_date ?? "").slice(0, 10)}
        />
      </LabField>
      <LabField label="截止日期">
        <input
          className={labInputClass}
          type="date"
          name="target_date"
          defaultValue={String(initial?.target_date ?? "").slice(0, 10)}
        />
      </LabField>
      {project && (
        <div key={project}>
          <ErrorMessage error={states.error ?? members.error ?? labels.error ?? cycles.error ?? modules.error} />
          <LabField label="状态">
            <select
              className={labInputClass}
              name="state_id"
              value={stateId}
              onChange={(event) => setStateId(event.target.value)}
            >
              <option value="">使用项目默认状态</option>
              {sameProject && initial?.state_id && !states.data?.some((state) => state.id === initial.state_id) && (
                <option value={initial.state_id}>保留当前状态</option>
              )}
              {states.data?.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          <ChoiceList
            label="负责人"
            name="assignee_ids"
            rows={(members.data ?? [])
              .filter((row) => row.is_active !== false && row.role >= 15)
              .map((row) => ({ id: row.member.id, name: userName(row.member) }))}
            initial={sameProject ? initial?.assignee_ids : []}
          />
          <ChoiceList
            label="标签"
            name="label_ids"
            rows={selections(labels.data ?? [])}
            initial={sameProject ? initial?.label_ids : []}
          />
          <LabField label="周期">
            <select
              className={labInputClass}
              name="cycle_id"
              value={cycleId}
              onChange={(event) => setCycleId(event.target.value)}
            >
              <option value="">无周期</option>
              {sameProject && initial?.cycle_id && !cycles.data?.some((cycle) => cycle.id === initial.cycle_id) && (
                <option value={initial.cycle_id}>保留当前周期</option>
              )}
              {cycles.data?.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          <ChoiceList
            label="模块"
            name="module_ids"
            rows={selections(modules.data ?? [])}
            initial={sameProject ? initial?.module_ids : []}
          />
          <LabField label="搜索父任务">
            <input
              className={labInputClass}
              value={parentSearch}
              onChange={(event) => setParentSearch(event.target.value)}
            />
          </LabField>
          <LabField label="父任务">
            <select
              className={labInputClass}
              name="parent_id"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">无父任务</option>
              {sameProject &&
                !!initial?.parent_id &&
                !records(tasks.data).some((task) => task.id === initial.parent_id) && (
                  <option value={String(initial.parent_id)}>保留当前父任务</option>
                )}
              {records(tasks.data).map((task) => (
                <option value={task.id} key={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </LabField>
        </div>
      )}
    </LabDialog>
  );
}
function selections(rows: Entity[]) {
  return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}
