/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { MobileSelect } from "../../components/select";
import { useState } from "react";
import { PageHeading } from "../../components/ui";
import type { LabTask } from "@plane/types";
import type { LabDocument, LabDocumentList, LabDocumentTaskList } from "./document-types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { Button, LabDialog, LabField, Empty, ErrorMessage, FloatingAction } from "./ui";
export function Documents({
  store,
  onOpenDocument,
  onOpenIssue,
}: {
  store: LabStore;
  onOpenDocument?: (project: string, page: string) => void;
  onOpenIssue?: (project: string, issue: string) => void;
}) {
  const [project, setProject] = useState(store.planner?.projects[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LabDocument>();
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");
  const [unlink, setUnlink] = useState<{ id: string; title: string }>();
  const docs = useResource<LabDocumentList>(
    store,
    project ? `projects/${project}/documents/?q=${encodeURIComponent(query)}` : null
  );
  const links = useResource<LabDocumentTaskList>(
    store,
    selected ? `documents/${selected.id}/tasks/?project_id=${selected.project_id}` : null
  );
  const tasks = useResource<LabTask[]>(
    store,
    linking && selected ? `tasks/?project_id=${selected.project_id}&q=${encodeURIComponent(taskQuery)}` : null
  );
  return (
    <>
      <PageHeading title="实验文档" />
      {docs.data?.can_edit && <FloatingAction label="新建实验记录" onClick={() => setCreating(true)} />}
      <ErrorMessage error={docs.error} />
      <LabField label="项目">
        <MobileSelect
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setSelected(undefined);
          }}
        >
          <option value="">请选择</option>
          {store.planner?.projects.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </MobileSelect>
      </LabField>
      <input
        className="lab-input"
        aria-label="搜索文档"
        placeholder="搜索文档"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {docs.data?.documents.map((row) => (
        <article key={row.id} className="lab-card">
          <button
            className="lab-card-row"
            disabled={!onOpenDocument}
            onClick={() => onOpenDocument?.(row.project_id, row.id)}
          >
            <h3>{row.name}</h3>
          </button>
          <div className="lab-card-meta">
            <span>{row.access === 1 ? "私人" : "项目成员"}</span>
            <span>{row.archived_at ? "已归档" : row.is_locked ? "已冻结" : "可编辑"}</span>
            <span title={row.updated_at}>{row.updated_at.slice(0, 16).replace("T", " ")}</span>
          </div>
          <div className="lab-actions">
            <Button onClick={() => setSelected(row)}>关联任务</Button>
          </div>
        </article>
      ))}
      {docs.data && !docs.data.documents.length && <Empty>暂无实验文档。</Empty>}
      {creating && (
        <LabDialog
          title="新建实验记录"
          onClose={() => setCreating(false)}
          onSubmit={async (form) => {
            const page = await store.request<LabDocument>(`projects/${project}/documents/`, "POST", {
              name: form.get("name"),
              access: form.get("private") === "on" ? 1 : 0,
            });
            await docs.refresh();
            setCreating(false);
            onOpenDocument?.(project, page.id);
          }}
        >
          <LabField label="名称">
            <input name="name" required maxLength={255} defaultValue="实验记录" />
          </LabField>
          <label className="lab-switch-field">
            <span>私人文档，仅本人可见</span>
            <input name="private" type="checkbox" />
          </label>
        </LabDialog>
      )}
      {selected && (
        <LabDialog title={`${selected.name} · 关联任务`} onClose={() => setSelected(undefined)}>
          <ErrorMessage error={links.error} />
          {links.data?.can_edit && !selected.is_locked && !selected.archived_at && (
            <Button onClick={() => setLinking(true)}>关联任务</Button>
          )}
          {links.data?.tasks.map((row) => (
            <article className="lab-card" key={row.id}>
              <h3>
                {row.key} {row.title}
              </h3>
              <div className="lab-actions">
                {onOpenIssue && <Button onClick={() => onOpenIssue(row.project_id, row.id)}>任务详情</Button>}
                {links.data?.can_edit && !selected.is_locked && !selected.archived_at && (
                  <Button onClick={() => setUnlink(row)}>解除关联</Button>
                )}
              </div>
            </article>
          ))}
          {links.data && !links.data.tasks.length && <Empty />}
        </LabDialog>
      )}
      {linking && selected && (
        <LabDialog
          title="关联同项目任务"
          onClose={() => setLinking(false)}
          onSubmit={async (form) => {
            await store.request(`documents/${selected.id}/tasks/`, "POST", { issue_id: form.get("issue_id") });
            await links.refresh();
            setLinking(false);
          }}
        >
          <LabField label="搜索任务">
            <input value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} />
          </LabField>
          <ErrorMessage error={tasks.error} />
          <LabField label="任务">
            <MobileSelect name="issue_id" required>
              <option value="">请选择</option>
              {tasks.data
                ?.filter((row) => !links.data?.tasks.some((link) => link.id === row.id))
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.key} {row.title}
                  </option>
                ))}
            </MobileSelect>
          </LabField>
        </LabDialog>
      )}
      {unlink && selected && (
        <LabDialog
          title="解除文档与任务关联"
          onClose={() => setUnlink(undefined)}
          onSubmit={async () => {
            await store.request(`documents/${selected.id}/tasks/`, "DELETE", { issue_id: unlink.id });
            await links.refresh();
            setUnlink(undefined);
          }}
        >
          <p>解除与“{unlink.title}”的关联，文档与任务将继续保留。</p>
        </LabDialog>
      )}
    </>
  );
}
export function TaskDocuments({
  store,
  projectId,
  issueId,
  onOpenDocument,
}: {
  store: LabStore;
  projectId: string;
  issueId: string;
  onOpenDocument?: (project: string, page: string) => void;
}) {
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<LabDocument>();
  const resource = useResource<LabDocumentList>(store, `tasks/${issueId}/documents/`);
  const choices = useResource<LabDocumentList>(store, linking ? `projects/${projectId}/documents/` : null);
  return (
    <section>
      <div className="lab-section-heading">
        <h3>关联实验文档</h3>
        {resource.data?.can_edit && (
          <div className="lab-actions">
            <Button onClick={() => setCreating(true)}>新建</Button>
            <Button onClick={() => setLinking(true)}>关联</Button>
          </div>
        )}
      </div>
      <ErrorMessage error={resource.error} />
      {resource.data?.documents.map((row) => (
        <article key={row.id} className="lab-card">
          <h3>{row.name}</h3>
          <div className="lab-actions">
            {onOpenDocument && <Button onClick={() => onOpenDocument(row.project_id, row.id)}>打开文档</Button>}
            {resource.data?.can_edit && !row.is_locked && !row.archived_at && (
              <Button onClick={() => setSelected(row)}>解除关联</Button>
            )}
          </div>
        </article>
      ))}
      {creating && (
        <LabDialog
          title="新建关联实验记录"
          onClose={() => setCreating(false)}
          onSubmit={async (form) => {
            const page = await store.request<LabDocument>(`projects/${projectId}/documents/`, "POST", {
              name: form.get("name"),
              access: form.get("private") === "on" ? 1 : 0,
              issue_id: issueId,
            });
            await resource.refresh();
            setCreating(false);
            onOpenDocument?.(projectId, page.id);
          }}
        >
          <LabField label="名称">
            <input name="name" maxLength={255} defaultValue="实验记录" required />
          </LabField>
          <label className="lab-switch-field">
            <span>私人文档</span>
            <input name="private" type="checkbox" />
          </label>
        </LabDialog>
      )}
      {linking && (
        <LabDialog
          title="关联已有文档"
          onClose={() => setLinking(false)}
          onSubmit={async (form) => {
            await store.request(`documents/${String(form.get("page_id"))}/tasks/`, "POST", { issue_id: issueId });
            await resource.refresh();
            setLinking(false);
          }}
        >
          <ErrorMessage error={choices.error} />
          <LabField label="同项目文档">
            <MobileSelect name="page_id" required>
              <option value="">请选择</option>
              {choices.data?.documents
                .filter((row) => !row.is_locked && !resource.data?.documents.some((d) => d.id === row.id))
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </MobileSelect>
          </LabField>
        </LabDialog>
      )}
      {selected && (
        <LabDialog
          title="解除文档关联"
          onClose={() => setSelected(undefined)}
          onSubmit={async () => {
            await store.request(`documents/${selected.id}/tasks/`, "DELETE", { issue_id: issueId });
            await resource.refresh();
            setSelected(undefined);
          }}
        >
          <p>解除与“{selected.name}”的关联。</p>
        </LabDialog>
      )}
    </section>
  );
}
