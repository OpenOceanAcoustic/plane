/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { ReactNode } from "react";
import { closestCenter, pointerWithin, rectIntersection, useDraggable, useDroppable } from "@dnd-kit/core";
import type { CollisionDetection, KeyboardCoordinateGetter } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { LabFolder, LabItem, LabStatus } from "@plane/types";
import { labBountyOutline } from "@plane/ui";

export const plannerCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type === "folder")
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => container.data.current?.type === "folder" && container.data.current?.sortable
      ),
    });
  // A card's handle is at its edge. Target the pointer so dropping onto a small
  // folder tab does not accidentally use the card's displaced center.
  const pointed = pointerWithin(args);
  if (pointed.length) return pointed;
  const intersected = rectIntersection(args);
  return intersected.length ? intersected : closestCenter(args);
};

export const plannerKeyboardCoordinates: KeyboardCoordinateGetter = (event, options) => {
  if (options.context.active?.data.current?.type === "folder") {
    if (!["ArrowLeft", "ArrowRight"].includes(event.code)) return undefined;
    event.preventDefault();
    const { context, currentCoordinates } = options;
    const folders = context.droppableContainers
      .getEnabled()
      .filter((container) => container.data.current?.sortable && container.data.current?.type === "folder");
    // Filter out status columns and the fixed unclassified target before choosing
    // the adjacent folder. They share this DndContext but are not sortable tabs.
    const currentId = folders.some((folder) => folder.id === context.over?.id) ? context.over!.id : context.active!.id;
    const current = folders.find((folder) => folder.id === currentId);
    const index = Number(current?.data.current?.sortable.index);
    const next = folders.find(
      (folder) => folder.data.current?.sortable.index === index + (event.code === "ArrowRight" ? 1 : -1)
    );
    const destination = next && context.droppableRects.get(next.id);
    const origin = context.collisionRect;
    if (!destination || !origin) return undefined;
    return {
      x: currentCoordinates.x + destination.left + destination.width / 2 - origin.left - origin.width / 2,
      y: currentCoordinates.y + destination.top + destination.height / 2 - origin.top - origin.height / 2,
    };
  }
  const directions = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!directions.includes(event.code)) return undefined;
  event.preventDefault();
  const { context, currentCoordinates } = options;
  const origin = context.collisionRect;
  if (!origin) return undefined;
  const x = origin.left + origin.width / 2,
    y = origin.top + origin.height / 2;
  const candidates = context.droppableContainers.getEnabled().flatMap((container) => {
    const rect = context.droppableRects.get(container.id);
    if (!rect || !["folder", "status"].includes(String(container.data.current?.type))) return [];
    const dx = rect.left + rect.width / 2 - x,
      dy = rect.top + rect.height / 2 - y;
    const horizontal = event.code === "ArrowLeft" || event.code === "ArrowRight";
    const distance = horizontal ? dx : dy;
    if (event.code === "ArrowRight" || event.code === "ArrowDown" ? distance <= 1 : distance >= -1) return [];
    return [{ dx, dy, score: Math.abs(distance) + Math.abs(horizontal ? dy : dx) * 3 }];
  });
  const target = candidates.reduce<(typeof candidates)[number] | undefined>(
    (best, next) => (!best || next.score < best.score ? next : best),
    undefined
  );
  return target ? { x: currentCoordinates.x + target.dx, y: currentCoordinates.y + target.dy } : undefined;
};

export function SortableFolder({
  folder,
  index,
  selected,
  count,
  onSelect,
  children,
}: {
  folder: LabFolder;
  index: number;
  selected: boolean;
  count: number;
  onSelect: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: `folder:${folder.id}`,
    data: { type: "folder", folderId: folder.id, label: folder.name },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, marginTop: (index % 3) * 4 }}
      className={`relative flex items-center gap-1 rounded-t-xl border border-b-0 px-2 ${selected || isOver ? "border-accent-strong bg-accent-primary/5" : "border-subtle bg-layer-1"} ${isDragging ? "z-30 opacity-50" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`拖动排序文件夹 ${folder.name}`}
        className="focus-visible:ring-accent-primary cursor-grab rounded p-1 text-tertiary focus-visible:ring-2"
      >
        <GripVertical size={13} />
      </button>
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex items-center gap-2 py-3 pr-2 pl-1 text-13 ${selected ? "font-semibold text-accent-primary" : "text-secondary"}`}
      >
        {folder.name}
        <span className="rounded bg-surface-1 px-1.5 text-11 text-tertiary">{count}</span>
      </button>
      {children}
    </div>
  );
}

export function UnclassifiedFolder({
  selected,
  count,
  onSelect,
}: {
  selected: boolean;
  count: number;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "folder:none",
    data: { type: "folder", folderId: null, label: "未分类" },
  });
  return (
    <button
      ref={setNodeRef}
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-t-xl border border-b-0 px-4 py-3 text-13 ${selected || isOver ? "border-accent-strong bg-accent-primary/5 text-accent-primary" : "border-subtle bg-layer-1 text-secondary"}`}
    >
      未分类 <span className="ml-2 text-11 text-tertiary">{count}</span>
    </button>
  );
}

export function StatusColumn({
  status,
  title,
  count,
  children,
}: {
  status: LabStatus;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `status:${status}`,
    data: { type: "status", status, label: title },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${title}事项`}
      className={`min-h-64 rounded-xl border p-3 transition-colors ${isOver ? "border-accent-strong bg-accent-primary/5" : "border-transparent bg-layer-1"}`}
    >
      <h2 className="mb-3 flex items-center justify-between text-13 font-semibold">
        <span>{title}</span>
        <span className="rounded bg-surface-1 px-2 py-0.5 text-12 text-tertiary">{count}</span>
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function DraggablePlanningCard({ item, children }: { item: LabItem; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: `item:${item.id}`,
    data: { type: "item", item },
  });
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        ...(item.bounty_id || item.is_bounty ? labBountyOutline(item.category_color) : {}),
      }}
      className={`lab-planner-card shadow-sm relative rounded-lg border border-subtle bg-surface-1 p-3 ${isDragging ? "z-30 opacity-50" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`拖动 ${item.title}`}
        className="focus-visible:ring-accent-primary absolute top-2 right-2 cursor-grab rounded p-1 text-tertiary focus-visible:ring-2"
      >
        <GripVertical size={14} />
      </button>
      {children}
    </article>
  );
}
