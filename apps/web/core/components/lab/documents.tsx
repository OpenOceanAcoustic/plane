/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";
import { documentLink } from "./document-types";
import type { LabDocument, LabDocumentList, LabDocumentTask, LabDocumentTaskList } from "./document-types";

function useDocumentTransport(workspaceSlug: string) {
  return useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
}

function RequestError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-12 text-danger-primary">
      {error instanceof Error ? error.message : typeof error === "string" ? error : "文档加载失败"}
    </p>
  );
}

export const LabExperimentTemplateButton = observer(function LabExperimentTemplateButton({
  workspaceSlug,
  projectId,
  issueId,
  defaultAccess = 0,
  onCreated,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId?: string;
  defaultAccess?: 0 | 1;
  onCreated?: () => Promise<unknown>;
}) {
  const transport = useDocumentTransport(workspaceSlug);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="neutral-primary" onClick={() => setOpen(true)}>
        新建实验记录
      </Button>
      {open && (
        <LabDialog
          title="新建实验记录"
          busy={transport.busy}
          onClose={() => setOpen(false)}
          onSubmit={(form) =>
            transport.execute(async () => {
              const document = await transport.request<LabDocument>(`projects/${projectId}/documents/`, "POST", {
                name: form.get("name"),
                access: form.get("private") === "on" ? 1 : 0,
                ...(issueId ? { issue_id: issueId } : {}),
              });
              await onCreated?.();
              setOpen(false);
              router.push(documentLink(workspaceSlug, document));
            })
          }
        >
          <LabField label="文档名称">
            <input name="name" required maxLength={255} className={labInputClass} defaultValue="实验记录" />
          </LabField>
          <label className="flex items-center gap-2 text-13">
            <input type="checkbox" name="private" defaultChecked={defaultAccess === 1} />
            私人文档（仅本人可见）
          </label>
          <p className="text-12 text-secondary">
            模板包含目标、方法、配置、结果、结论及后续事项。附件和历史版本在文档中维护。
          </p>
          <RequestError error={transport.error} />
        </LabDialog>
      )}
    </>
  );
});

export const LabTaskDocuments = observer(function LabTaskDocuments({
  workspaceSlug,
  projectId,
  issueId,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
}) {
  const transport = useDocumentTransport(workspaceSlug);
  const { data, error, mutate, isLoading } = useSWR(["lab-task-documents", workspaceSlug, issueId], () =>
    transport.request<LabDocumentList>(`tasks/${issueId}/documents/`)
  );
  const [mode, setMode] = useState<"link" | "unlink">();
  const [chosen, setChosen] = useState<LabDocument>();
  const [query, setQuery] = useState("");
  const { data: available, error: availableError } = useSWR(
    mode === "link" ? ["lab-project-documents", workspaceSlug, projectId, query] : null,
    () => transport.request<LabDocumentList>(`projects/${projectId}/documents/?q=${encodeURIComponent(query)}`)
  );
  return (
    <section aria-label="关联文档" className="flex flex-col gap-3 rounded-md border border-subtle bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-14 font-semibold">关联文档</h3>
        {data?.can_edit && (
          <>
            <LabExperimentTemplateButton
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              onCreated={mutate}
            />
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() => {
                setQuery("");
                setMode("link");
              }}
            >
              关联已有文档
            </Button>
          </>
        )}
      </div>
      <RequestError error={error || transport.error} />
      {isLoading && <p className="text-12 text-secondary">正在加载文档…</p>}
      {data && data.documents.length === 0 && <p className="text-12 text-tertiary">尚未关联项目文档。</p>}
      <ul className="flex flex-col gap-2">
        {data?.documents.map((document) => (
          <li key={document.id} className="flex items-center gap-2 rounded bg-layer-1 px-3 py-2 text-13">
            <a href={documentLink(workspaceSlug, document)} className="min-w-0 flex-1 truncate text-accent-primary">
              {document.name}
            </a>
            {document.access === 1 && <span className="text-11 text-tertiary">私人</span>}
            {document.archived_at && <span className="text-11 text-tertiary">已归档</span>}
            {data.can_edit && !document.is_locked && !document.archived_at && (
              <Button
                size="sm"
                variant="neutral-primary"
                onClick={() => {
                  setChosen(document);
                  setMode("unlink");
                }}
              >
                解除关联
              </Button>
            )}
          </li>
        ))}
      </ul>
      {mode === "link" && (
        <LabDialog
          title="关联同项目文档"
          busy={transport.busy}
          onClose={() => setMode(undefined)}
          onSubmit={(form) =>
            transport.execute(async () => {
              await transport.request(`documents/${String(form.get("page_id"))}/tasks/`, "POST", { issue_id: issueId });
              await mutate();
              setMode(undefined);
            })
          }
        >
          <LabField label="搜索文档">
            <input className={labInputClass} value={query} onChange={(event) => setQuery(event.target.value)} />
          </LabField>
          <LabField label="选择文档">
            <select name="page_id" required className={labInputClass} defaultValue="">
              <option value="">请选择</option>
              {available?.documents
                .filter((document) => !document.is_locked && !data?.documents.some((row) => row.id === document.id))
                .map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                    {document.access === 1 ? " · 私人" : ""}
                  </option>
                ))}
            </select>
          </LabField>
          <RequestError error={availableError || transport.error} />
        </LabDialog>
      )}
      {mode === "unlink" && chosen && (
        <LabDialog
          title="解除文档关联"
          busy={transport.busy}
          onClose={() => setMode(undefined)}
          onSubmit={() =>
            transport.execute(async () => {
              await transport.request(`documents/${chosen.id}/tasks/`, "DELETE", { issue_id: issueId });
              await mutate();
              setMode(undefined);
            })
          }
        >
          <p className="text-13">解除与“{chosen.name}”的关联。文档及其历史版本继续保留。</p>
          <RequestError error={transport.error} />
        </LabDialog>
      )}
    </section>
  );
});

export const LabPageTasks = observer(function LabPageTasks({
  workspaceSlug,
  projectId,
  pageId,
}: {
  workspaceSlug: string;
  projectId: string;
  pageId: string;
}) {
  const transport = useDocumentTransport(workspaceSlug);
  const { data, error, mutate } = useSWR(["lab-page-tasks", workspaceSlug, projectId, pageId], () =>
    transport.request<LabDocumentTaskList>(`documents/${pageId}/tasks/?project_id=${projectId}`)
  );
  const [mode, setMode] = useState<"link" | "unlink">();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<LabDocumentTask>();
  const { data: tasks, error: tasksError } = useSWR(
    mode === "link" ? ["lab-document-search", workspaceSlug, projectId, query] : null,
    () => transport.request<LabDocumentTask[]>(`tasks/?project_id=${projectId}&q=${encodeURIComponent(query)}`)
  );
  return (
    <details className="mx-page-x mb-3 shrink-0 rounded-md border border-subtle bg-layer-1 text-12">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        关联任务{data?.tasks.length ? `（${data.tasks.length}）` : ""}
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <RequestError error={error || transport.error} />
        {data?.tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2">
            <a
              className="flex-1 text-accent-primary"
              href={`/${workspaceSlug}/projects/${task.project_id}/issues/${task.id}`}
            >
              {task.key} · {task.title}
            </a>
            {data.can_edit && (
              <Button
                size="sm"
                variant="neutral-primary"
                onClick={() => {
                  setChosen(task);
                  setMode("unlink");
                }}
              >
                解除关联
              </Button>
            )}
          </div>
        ))}
        {data?.tasks.length === 0 && <p className="text-tertiary">尚未关联任务。</p>}
        {data?.can_edit && (
          <div>
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() => {
                setMode("link");
                setQuery("");
              }}
            >
              关联同项目任务
            </Button>
          </div>
        )}
      </div>
      {mode === "link" && (
        <LabDialog
          title="关联同项目任务"
          busy={transport.busy}
          onClose={() => setMode(undefined)}
          onSubmit={(form) =>
            transport.execute(async () => {
              await transport.request(`documents/${pageId}/tasks/`, "POST", { issue_id: form.get("issue_id") });
              await mutate();
              setMode(undefined);
            })
          }
        >
          <LabField label="搜索任务">
            <input className={labInputClass} value={query} onChange={(event) => setQuery(event.target.value)} />
          </LabField>
          <LabField label="选择任务">
            <select name="issue_id" required className={labInputClass} defaultValue="">
              <option value="">请选择</option>
              {tasks
                ?.filter((task) => task.project_id === projectId && !data?.tasks.some((row) => row.id === task.id))
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.key} · {task.title}
                  </option>
                ))}
            </select>
          </LabField>
          <RequestError error={tasksError || transport.error} />
        </LabDialog>
      )}
      {mode === "unlink" && chosen && (
        <LabDialog
          title="解除任务关联"
          busy={transport.busy}
          onClose={() => setMode(undefined)}
          onSubmit={() =>
            transport.execute(async () => {
              await transport.request(`documents/${pageId}/tasks/`, "DELETE", { issue_id: chosen.id });
              await mutate();
              setMode(undefined);
            })
          }
        >
          <p className="text-13">
            解除与“{chosen.key} · {chosen.title}”的关联。
          </p>
          <RequestError error={transport.error} />
        </LabDialog>
      )}
    </details>
  );
});

export const LabProjectDocuments = observer(function LabProjectDocuments({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectId: string;
}) {
  const transport = useDocumentTransport(workspaceSlug);
  const { data, error, mutate } = useSWR(["lab-project-documents", workspaceSlug, projectId], () =>
    transport.request<LabDocumentList>(`projects/${projectId}/documents/`)
  );
  return (
    <section className="flex flex-col gap-3 rounded-md border border-subtle p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-14 font-semibold">项目文档</h2>
        {data?.can_edit && (
          <LabExperimentTemplateButton workspaceSlug={workspaceSlug} projectId={projectId} onCreated={mutate} />
        )}
      </div>
      <RequestError error={error} />
      {data?.documents.map((document) => (
        <a key={document.id} href={documentLink(workspaceSlug, document)} className="text-13 text-accent-primary">
          {document.name}
        </a>
      ))}
      {data?.documents.length === 0 && <p className="text-12 text-tertiary">暂无文档。</p>}
    </section>
  );
});
