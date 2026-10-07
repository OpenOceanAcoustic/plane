/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Folder, Plus, CalendarDays, Trash2, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@plane/ui";
import type { LabItem, LabStatus, LabTask } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";

const statuses: { key: LabStatus; title: string }[] = [
  { key: "todo", title: "待做" },
  { key: "active", title: "进行中" },
  { key: "review", title: "待验收" },
  { key: "done", title: "完成" },
];

export const LabPlannerBoard = observer(function LabPlannerBoard({
  store,
  schedule,
}: {
  store: LabStore;
  schedule: (item: LabItem) => void;
}) {
  const [selected, setSelected] = useState<string | null | "all">("all");
  const [dialog, setDialog] = useState<"folder" | "item" | "reference" | "mapping" | null>(null);
  const [editing, setEditing] = useState<LabItem>();
  const [tasks, setTasks] = useState<LabTask[]>([]);
  const [projectId, setProjectId] = useState("");
  const planner = store.planner;
  if (!planner) return null;
  const items = planner.items.filter((item) => selected === "all" || item.folder_id === selected);
  const mutation = (path: string, method: string, body?: unknown) =>
    store.execute(async () => {
      await store.request(path, method, body);
      await store.loadPlanner();
    });
  const finish = async (action: () => Promise<void>) => {
    await store.execute(async () => {
      await action();
      await store.loadPlanner();
      setDialog(null);
      setEditing(undefined);
    });
  };
  function moveFolder(id: string, offset: number) {
    const ids = planner!.folders.map((folder) => folder.id);
    const index = ids.indexOf(id),
      target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void mutation("folders/", "PUT", { ids });
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="neutral-primary"
          onClick={() => {
            setEditing(undefined);
            setDialog("item");
          }}
          prependIcon={<Plus size={14} />}
        >
          个人事项
        </Button>
        <Button
          variant="neutral-primary"
          onClick={() => {
            setTasks([]);
            setDialog("reference");
          }}
        >
          引用项目任务
        </Button>
        <Button variant="neutral-primary" onClick={() => setDialog("folder")}>
          新增文件夹
        </Button>
        {planner.projects.some((project) => project.lead) && (
          <Button
            variant="neutral-primary"
            onClick={() => {
              setProjectId(planner.projects.find((project) => project.lead)!.id);
              setDialog("mapping");
            }}
          >
            项目状态映射
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-1 border-b border-subtle pb-0">
        {[{ id: "all", name: "全部" }, ...planner.folders, { id: "none", name: "未分类" }].map((folder, index) => (
          <div
            key={folder.id}
            className="group flex items-center rounded-t-lg border border-b-0 border-subtle bg-layer-1 px-2"
            style={{ marginTop: (index % 3) * 3, transform: `translateY(${(index % 3) * -2}px)` }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("lab-item");
              if (id && folder.id !== "all")
                void mutation(`items/${id}/`, "PATCH", { folder_id: folder.id === "none" ? null : folder.id });
            }}
          >
            <button
              className={`flex items-center gap-1.5 px-2 py-2 text-13 ${selected === (folder.id === "none" ? null : folder.id) ? "font-semibold text-accent-primary" : "text-secondary"}`}
              onClick={() => setSelected(folder.id === "none" ? null : folder.id)}
            >
              <Folder size={14} />
              {folder.name}
            </button>
            {!["all", "none"].includes(folder.id) && (
              <details className="relative text-12">
                <summary aria-label={`${folder.name} 文件夹操作`} className="cursor-pointer list-none px-1">
                  ⋯
                </summary>
                <div className="shadow-lg absolute z-20 flex min-w-32 flex-col gap-1 rounded border border-subtle bg-surface-1 p-2">
                  <button
                    className="flex gap-2"
                    onClick={() => {
                      const name = window.prompt("文件夹名称", folder.name);
                      if (name) void mutation(`folders/${folder.id}/`, "PATCH", { name });
                    }}
                  >
                    <Pencil size={12} />
                    改名
                  </button>
                  <button className="flex gap-2" onClick={() => moveFolder(folder.id, -1)}>
                    <ChevronLeft size={12} />
                    前移
                  </button>
                  <button className="flex gap-2" onClick={() => moveFolder(folder.id, 1)}>
                    <ChevronRight size={12} />
                    后移
                  </button>
                  <button
                    className="flex gap-2"
                    onClick={() => {
                      if (window.confirm("删除文件夹后事项回到未分类，是否继续？")) {
                        setSelected("all");
                        void mutation(`folders/${folder.id}/`, "DELETE");
                      }
                    }}
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
      <div className="grid min-w-[760px] grid-cols-4 gap-4">
        {statuses.map((status) => (
          <section
            key={status.key}
            className="min-h-60 rounded-lg bg-layer-1 p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("lab-item");
              if (id) void mutation(`items/${id}/`, "PATCH", { status: status.key });
            }}
          >
            <h2 className="mb-3 flex justify-between text-13 font-semibold">
              {status.title}
              <span className="text-tertiary">{items.filter((item) => item.status === status.key).length}</span>
            </h2>
            <div className="flex flex-col gap-2">
              {items
                .filter((item) => item.status === status.key)
                .map((item) => (
                  <article
                    key={item.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("lab-item", item.id)}
                    className="shadow-sm rounded-md border border-subtle bg-surface-1 p-3"
                  >
                    <p className="mb-2 text-14 font-medium">
                      {item.issue_id ? (
                        <a
                          href={`/${store.slug}/projects/${item.project_id}/issues/${item.issue_id}`}
                          className="hover:text-accent-primary"
                        >
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </p>
                    <p className="mb-3 text-12 text-tertiary">
                      {item.issue_id ? "项目任务" : item.public ? "公开事项" : "私人事项"}
                      {item.archived ? " · 已归档" : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      <select
                        aria-label={`${item.title}状态`}
                        className="rounded border border-subtle bg-surface-1 p-1 text-12"
                        value={item.status}
                        onChange={(event) =>
                          void mutation(`items/${item.id}/`, "PATCH", { status: event.target.value })
                        }
                      >
                        {statuses.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.title}
                          </option>
                        ))}
                      </select>
                      <button
                        aria-label={`安排${item.title}`}
                        className="rounded p-1 hover:bg-layer-1"
                        onClick={() => schedule(item)}
                      >
                        <CalendarDays size={14} />
                      </button>
                      <button
                        aria-label={`编辑${item.title}`}
                        className="rounded p-1 hover:bg-layer-1"
                        onClick={() => {
                          setEditing(item);
                          setDialog("item");
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label={`移除${item.title}`}
                        className="rounded p-1 hover:bg-layer-1"
                        onClick={() => {
                          if (window.confirm("从个人规划移除，并删除本人时间块？项目任务仍然保留。"))
                            void mutation(`items/${item.id}/`, "DELETE");
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
      {dialog === "folder" && (
        <LabDialog
          title="新增文件夹"
          busy={store.busy}
          onClose={() => setDialog(null)}
          onSubmit={(data) => finish(() => store.request("folders/", "POST", { name: data.get("name") }))}
        >
          <LabField label="名称">
            <input className={labInputClass} name="name" required maxLength={40} />
          </LabField>
        </LabDialog>
      )}
      {dialog === "item" && (
        <LabDialog
          title={editing ? "编辑规划" : "新增个人事项"}
          busy={store.busy}
          onClose={() => setDialog(null)}
          onSubmit={(data) =>
            finish(() =>
              store.request(editing ? `items/${editing.id}/` : "items/", editing ? "PATCH" : "POST", {
                title: data.get("title"),
                description: data.get("description"),
                kind: data.get("kind"),
                folder_id: data.get("folder_id") || null,
                public: data.get("public") === "on",
              })
            )
          }
        >
          {!editing?.issue_id && (
            <>
              <LabField label="事项名称">
                <input className={labInputClass} name="title" defaultValue={editing?.title} required maxLength={255} />
              </LabField>
              <LabField label="类型">
                <select className={labInputClass} name="kind" defaultValue={editing?.kind ?? "research"}>
                  <option value="research">科研</option>
                  <option value="study">学习</option>
                  <option value="mentoring">带教</option>
                </select>
              </LabField>
              <LabField label="说明">
                <textarea className={labInputClass} name="description" defaultValue={editing?.description} />
              </LabField>
              <label className="text-13">
                <input type="checkbox" name="public" defaultChecked={editing?.public} /> 向负责人公开事项内容
              </label>
            </>
          )}
          <LabField label="文件夹">
            <select
              className={labInputClass}
              name="folder_id"
              defaultValue={editing?.folder_id ?? (selected === "all" ? "" : (selected ?? ""))}
            >
              <option value="">未分类</option>
              {planner.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </LabField>
        </LabDialog>
      )}
      {dialog === "reference" && (
        <LabDialog
          title="引用有权限的项目任务"
          busy={store.busy}
          onClose={() => setDialog(null)}
          onSubmit={(data) =>
            finish(() =>
              store.request("items/", "POST", {
                issue_id: data.get("issue_id"),
                folder_id: data.get("folder_id") || null,
              })
            )
          }
        >
          <LabField label="搜索任务">
            <input
              className={labInputClass}
              placeholder="输入关键词"
              onChange={(event) =>
                void store.execute(async () => {
                  setTasks(await store.request<LabTask[]>(`tasks/?q=${encodeURIComponent(event.target.value)}`));
                })
              }
            />
          </LabField>
          <LabField label="选择任务">
            <select className={labInputClass} name="issue_id" required>
              <option value="">请选择</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.key} · {task.title}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="文件夹">
            <select className={labInputClass} name="folder_id">
              <option value="">未分类</option>
              {planner.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </LabField>
        </LabDialog>
      )}
      {dialog === "mapping" && (
        <LabDialog
          title="四类项目状态映射"
          busy={store.busy}
          onClose={() => setDialog(null)}
          onSubmit={(data) =>
            finish(() =>
              store.request(
                `flows/${projectId}/`,
                "PUT",
                Object.fromEntries(statuses.map((status) => [status.key, data.get(status.key)]))
              )
            )
          }
        >
          <LabField label="项目">
            <select className={labInputClass} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {planner.projects
                .filter((project) => project.lead)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
          </LabField>
          <p className="text-12 text-secondary">待验收须使用单独的进行中状态。可在项目设置中新增“待验收”。</p>
          {statuses.map((status) => (
            <LabField key={`${projectId}-${status.key}`} label={status.title}>
              <select
                className={labInputClass}
                name={status.key}
                required
                defaultValue={planner.projects.find((project) => project.id === projectId)?.mapping[status.key] ?? ""}
              >
                <option value="">请选择</option>
                {planner.projects
                  .find((project) => project.id === projectId)
                  ?.states.filter((state) =>
                    status.key === "done"
                      ? state.group === "completed"
                      : status.key === "todo"
                        ? ["backlog", "unstarted"].includes(state.group)
                        : state.group === "started"
                  )
                  .map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
              </select>
            </LabField>
          ))}
        </LabDialog>
      )}
    </div>
  );
});
