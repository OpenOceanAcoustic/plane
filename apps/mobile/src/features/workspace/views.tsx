import { PageHeading } from "../../components/ui";
import { useState } from "react";
import { ErrorMessage, records, useData, type Entity } from "../../components/ui";
import { groupNames, priorities, userName, type Member } from "../core/model";
import { Button, LabDialog, LabField, labInputClass } from "../lab/ui";
import { viewQuery, type Page, type WorkspaceProps } from "./business";
import { Pagination, Status, TaskRows, useWorkspace, useDetailBack } from "./shared";
type SavedView = Entity & {
  id: string;
  name: string;
  owned_by?: string;
  is_locked?: boolean;
  filters?: Record<string, unknown>;
};
const filterArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? value.split(",") : [];
export default function WorkspaceViews(props: WorkspaceProps) {
  const { client, onNavigate } = props,
    { base, role, session, projects } = useWorkspace(props);
  const views = useData<SavedView[]>(client, `${base}/views/`),
    members = useData<Member[]>(client, `${base}/members/`);
  const [selected, setSelected] = useState<SavedView>(),
    [modal, setModal] = useState<"create" | "edit" | "delete">(),
    [cursor, setCursor] = useState(""),
    [query, setQuery] = useState("");
  const detail = useData<SavedView>(client, selected ? `${base}/views/${selected.id}/` : null),
    row = detail.data ?? selected;
  const tasks = useData<Page<Entity>>(client, row ? `${base}/issues/?${viewQuery(row.filters ?? {}, cursor)}` : null);
  const list = (views.data ?? []).filter((view) => view.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useDetailBack(!!selected, () => {
    setSelected(undefined);
    setCursor("");
  });
  const canEdit = row?.owned_by === session.data?.user.id && !row?.is_locked,
    canDelete = role >= 20 || row?.owned_by === session.data?.user.id;
  return (
    <>
      <PageHeading title={row ? row.name : "工作区视图"}>
        {!row && role >= 5 && (
          <Button variant="primary" onClick={() => setModal("create")}>
            新建视图
          </Button>
        )}
      </PageHeading>
      {row ? (
        <>
          <div className="lab-actions">
            <Button
              onClick={() => {
                setSelected(undefined);
                setCursor("");
              }}
            >
              返回视图
            </Button>
            {canEdit && <Button onClick={() => setModal("edit")}>编辑筛选</Button>}
            {canDelete && <Button onClick={() => setModal("delete")}>删除视图</Button>}
          </div>
          <p className="lab-muted">{String(row.description ?? "")}</p>
          {row.is_locked && <p className="lab-muted">视图已锁定</p>}
          <ErrorMessage error={detail.error} />
          <Status loading={tasks.loading} error={tasks.error} empty={!records(tasks.data).length} />
          <TaskRows rows={records(tasks.data)} onNavigate={onNavigate} />
          <Pagination page={tasks.data} onChange={setCursor} />
        </>
      ) : (
        <>
          <LabField label="搜索视图">
            <input className={labInputClass} value={query} onChange={(event) => setQuery(event.target.value)} />
          </LabField>
          <Status loading={views.loading} error={views.error} empty={!list.length} />
          <div className="lab-list">
            {list.map((view) => (
              <article className="lab-card" key={view.id}>
                <button
                  className="record-title"
                  onClick={() => {
                    setSelected(view);
                    setCursor("");
                  }}
                >
                  {view.name}
                </button>
                <p className="lab-muted">{String(view.description ?? "")}</p>
                <p>
                  {view.access === 1 ? "公开视图" : "个人视图"}
                  {view.is_locked ? " · 已锁定" : ""}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
      {(modal === "create" || modal === "edit") && (
        <LabDialog
          title={modal === "create" ? "新建工作区视图" : "编辑工作区视图"}
          onClose={() => setModal(undefined)}
          onSubmit={async (data) => {
            const previous = modal === "edit" ? (row?.filters ?? {}) : {};
            const filters: Record<string, unknown> = {
              ...previous,
              project: data.getAll("project"),
              state_group: data.getAll("state_group"),
              priority: data.getAll("priority"),
              assignees: data.getAll("assignees"),
            };
            const body = {
              name: String(data.get("name") ?? "").trim(),
              description: String(data.get("description") ?? ""),
              filters,
            };
            const updated = await client.request<SavedView>(
              `${base}/views/${modal === "edit" && row ? `${row.id}/` : ""}`,
              modal === "edit" ? "PATCH" : "POST",
              body
            );
            await views.refresh();
            setSelected(updated);
            setCursor("");
            await detail.refresh();
            setModal(undefined);
          }}
        >
          <LabField label="视图名称">
            <input
              className={labInputClass}
              name="name"
              required
              maxLength={255}
              defaultValue={modal === "edit" ? row?.name : ""}
            />
          </LabField>
          <LabField label="描述">
            <textarea
              className={labInputClass}
              name="description"
              defaultValue={modal === "edit" ? String(row?.description ?? "") : ""}
            />
          </LabField>
          <FilterChoices
            label="项目"
            name="project"
            options={(projects.data ?? []).map((project) => ({ id: String(project.id), name: String(project.name) }))}
            values={modal === "edit" ? filterArray(row?.filters?.project) : []}
          />
          <FilterChoices
            label="状态"
            name="state_group"
            options={Object.entries(groupNames).map(([id, name]) => ({ id, name }))}
            values={modal === "edit" ? filterArray(row?.filters?.state_group) : []}
          />
          <FilterChoices
            label="优先级"
            name="priority"
            options={priorities.map((priority) => ({ id: priority.value, name: priority.label }))}
            values={modal === "edit" ? filterArray(row?.filters?.priority) : []}
          />
          <FilterChoices
            label="负责人"
            name="assignees"
            options={(members.data ?? [])
              .filter((member) => member.is_active !== false)
              .map((member) => ({ id: member.member.id, name: userName(member.member) }))}
            values={modal === "edit" ? filterArray(row?.filters?.assignees) : []}
          />
          <p className="lab-muted">未勾选表示全部。</p>
        </LabDialog>
      )}
      {modal === "delete" && row && (
        <LabDialog
          title="删除工作区视图"
          submitLabel="确认删除"
          destructive
          onClose={() => setModal(undefined)}
          onSubmit={async () => {
            await client.request(`${base}/views/${row.id}/`, "DELETE");
            await views.refresh();
            setSelected(undefined);
            setModal(undefined);
          }}
        >
          <p>删除“{row.name}”？</p>
        </LabDialog>
      )}
    </>
  );
}
function FilterChoices({
  label,
  name,
  options,
  values,
}: {
  label: string;
  name: string;
  options: { id: string; name: string }[];
  values: string[];
}) {
  return (
    <fieldset className="workspace-choices">
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option.id}>
          <input type="checkbox" name={name} value={option.id} defaultChecked={values.includes(option.id)} />
          {option.name}
        </label>
      ))}
    </fieldset>
  );
}
