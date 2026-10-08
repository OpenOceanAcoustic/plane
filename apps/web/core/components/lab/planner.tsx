/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { observer } from "mobx-react";
import { Folder, Plus, CalendarDays, Trash2, Pencil } from "lucide-react";
import { Button } from "@plane/ui";
import type { LabFolder, LabItem, LabStatus, LabTask } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";
import {
  DraggablePlanningCard,
  SortableFolder,
  StatusColumn,
  UnclassifiedFolder,
  plannerKeyboardCoordinates,
  plannerCollisionDetection,
} from "./planner-dnd";

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
  const [dialog, setDialog] = useState<
    "folder" | "item" | "reference" | "mapping" | "delete-folder" | "delete-item" | null
  >(null);
  const [editing, setEditing] = useState<LabItem>();
  const [editingFolder, setEditingFolder] = useState<LabFolder>();
  const [query, setQuery] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: plannerKeyboardCoordinates })
  );
  useEffect(() => {
    if (dialog !== "reference") return;
    let active = true;
    const timer = window.setTimeout(() => {
      void store
        .request<LabTask[]>(`tasks/?q=${encodeURIComponent(query)}`)
        .then((rows) => {
          if (active) setTasks(rows);
          return rows;
        })
        .catch((error: unknown) => {
          store.error = error instanceof Error ? error.message : "搜索失败";
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, dialog, store]);
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
  async function dropped(event: DragEndEvent) {
    const source = event.active.data.current,
      target = event.over?.data.current;
    if (!source || !target) return;
    if (source.type === "folder" && target.type === "folder" && target.folderId) {
      const ids = planner!.folders.map((folder) => folder.id);
      const from = ids.indexOf(String(source.folderId)),
        to = ids.indexOf(String(target.folderId));
      if (from >= 0 && to >= 0 && from !== to) await mutation("folders/", "PUT", { ids: arrayMove(ids, from, to) });
    }
    if (source.type === "item") {
      const item = source.item as LabItem;
      if (target.type === "folder" && target.folderId !== item.folder_id)
        await mutation(`items/${item.id}/`, "PATCH", { folder_id: target.folderId });
      if (target.type === "status" && target.status !== item.status)
        await mutation(`items/${item.id}/`, "PATCH", { status: target.status });
    }
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
        <Button
          variant="neutral-primary"
          onClick={() => {
            setEditingFolder(undefined);
            setDialog("folder");
          }}
        >
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
      <DndContext
        sensors={sensors}
        collisionDetection={plannerCollisionDetection}
        onDragEnd={(event) => void dropped(event)}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) =>
              `已拿起${active.data.current?.type === "folder" ? "文件夹" : "事项"}，用方向键移动，空格放下，Esc 取消`,
            onDragOver: ({ over }) => (over ? `移动到${String(over.data.current?.label ?? "目标区域")}` : undefined),
            onDragEnd: () => "已放下，正在保存",
            onDragCancel: () => "已取消移动",
          },
          screenReaderInstructions: { draggable: "按空格拿起，用方向键选择目标，按空格放下，Escape 取消。" },
        }}
      >
        <div className="flex flex-wrap items-end gap-1 border-b border-subtle">
          <button
            onClick={() => setSelected("all")}
            aria-pressed={selected === "all"}
            className={`flex items-center gap-2 rounded-t-xl border border-b-0 px-4 py-3 text-13 ${selected === "all" ? "border-accent-strong text-accent-primary" : "border-subtle text-secondary"}`}
          >
            <Folder size={14} />
            全部<span className="text-11 text-tertiary">{planner.items.length}</span>
          </button>
          <SortableContext
            items={planner.folders.map((folder) => `folder:${folder.id}`)}
            strategy={horizontalListSortingStrategy}
          >
            {planner.folders.map((folder, index) => (
              <SortableFolder
                key={folder.id}
                folder={folder}
                index={index}
                selected={selected === folder.id}
                count={planner.items.filter((item) => item.folder_id === folder.id).length}
                onSelect={() => setSelected(folder.id)}
              >
                <details className="relative text-12">
                  <summary
                    aria-label={`${folder.name} 文件夹操作`}
                    className="cursor-pointer list-none rounded px-1 py-2 text-secondary"
                  >
                    ⋯
                  </summary>
                  <div className="shadow-md absolute right-0 z-40 flex min-w-32 flex-col gap-1 rounded-md border border-subtle bg-surface-1 p-1">
                    <button
                      className="flex items-center gap-2 rounded px-2 py-2 text-left hover:bg-layer-1"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        setEditingFolder(folder);
                        setDialog("folder");
                      }}
                    >
                      <Pencil size={12} />
                      改名
                    </button>
                    <button
                      className="flex items-center gap-2 rounded px-2 py-2 text-left text-danger-primary hover:bg-layer-1"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        setEditingFolder(folder);
                        setDialog("delete-folder");
                      }}
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </div>
                </details>
              </SortableFolder>
            ))}
          </SortableContext>
          <UnclassifiedFolder
            selected={selected === null}
            count={planner.items.filter((item) => !item.folder_id).length}
            onSelect={() => setSelected(null)}
          />
        </div>
        <div className="mt-5 grid min-w-[760px] grid-cols-4 gap-4">
          {statuses.map((status) => (
            <StatusColumn
              key={status.key}
              status={status.key}
              title={status.title}
              count={items.filter((item) => item.status === status.key).length}
            >
              {items
                .filter((item) => item.status === status.key)
                .map((item) => (
                  <DraggablePlanningCard key={item.id} item={item}>
                    <p className="mb-2 pr-6 text-14 font-medium">
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
                        disabled={store.busy}
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
                        className="rounded p-1.5 hover:bg-layer-1"
                        onClick={() => schedule(item)}
                      >
                        <CalendarDays size={14} />
                      </button>
                      <button
                        aria-label={`编辑${item.title}`}
                        className="rounded p-1.5 hover:bg-layer-1"
                        onClick={() => {
                          setEditing(item);
                          setDialog("item");
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label={`移除${item.title}`}
                        className="rounded p-1.5 hover:bg-layer-1"
                        onClick={() => {
                          setEditing(item);
                          setDialog("delete-item");
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </DraggablePlanningCard>
                ))}
              {!items.some((item) => item.status === status.key) && (
                <p className="py-8 text-center text-12 text-tertiary">暂无事项，拖入卡片或新增</p>
              )}
            </StatusColumn>
          ))}
        </div>
      </DndContext>
      {dialog === "delete-folder" && editingFolder && (
        <LabDialog
          title={`删除文件夹 ${editingFolder.name}`}
          submitLabel="删除"
          destructive
          busy={store.busy}
          error={store.error}
          onClose={() => setDialog(null)}
          onSubmit={() =>
            finish(async () => {
              await store.request(`folders/${editingFolder.id}/`, "DELETE");
              setSelected(null);
            })
          }
        >
          <p className="text-13 text-secondary">其中的事项和时间块会保留，事项回到“未分类”。</p>
        </LabDialog>
      )}
      {dialog === "delete-item" && editing && (
        <LabDialog
          title="移除个人规划事项"
          submitLabel="移除"
          destructive
          busy={store.busy}
          error={store.error}
          onClose={() => setDialog(null)}
          onSubmit={() => finish(() => store.request(`items/${editing.id}/`, "DELETE"))}
        >
          <p className="text-13 text-secondary">移除“{editing.title}”和本人对应的时间块；引用的项目任务会保留。</p>
        </LabDialog>
      )}
      {dialog === "folder" && (
        <LabDialog
          title={editingFolder ? "文件夹改名" : "新增文件夹"}
          busy={store.busy}
          error={store.error}
          onClose={() => setDialog(null)}
          onSubmit={(data) =>
            finish(() =>
              store.request(
                editingFolder ? `folders/${editingFolder.id}/` : "folders/",
                editingFolder ? "PATCH" : "POST",
                { name: data.get("name") }
              )
            )
          }
        >
          <LabField label="名称">
            <input className={labInputClass} name="name" defaultValue={editingFolder?.name} required maxLength={40} />
          </LabField>
        </LabDialog>
      )}
      {dialog === "item" && (
        <LabDialog
          title={editing ? "编辑规划" : "新增个人事项"}
          busy={store.busy}
          error={store.error}
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
          error={store.error}
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
              value={query}
              onChange={(event) => setQuery(event.target.value)}
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
          error={store.error}
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
