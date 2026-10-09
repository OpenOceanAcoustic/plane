/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CalendarDays, Clock3, Globe2, LockKeyhole, Maximize2, Minimize2, Pencil } from "lucide-react";
import type { LabEvent, LabItem, LabStatus } from "@plane/types";
import { Button, LabBountyBadge } from "@plane/ui";

export type LabProjectIssueRef = { issue_id: string; project_id: string; archived?: boolean };
export type LabOpenProjectIssue = (issue: LabProjectIssueRef) => void;

export function labCanOpenProjectIssue(item: LabItem): item is LabItem & { issue_id: string; project_id: string } {
  return Boolean(
    item.issue_id && item.project_id && (item.can_open_issue ?? (!item.bounty_id || item.can_edit_issue !== false))
  );
}

export function LabItemOverviewSurface({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [expanded, setExpanded] = useState(false);
  const portal = document.getElementById("full-screen-portal");
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        close.current();
    };
    const outside = (event: PointerEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.target instanceof Node && !panel.current?.contains(event.target)) close.current();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={title}
      aria-modal={false}
      tabIndex={-1}
      data-lab-item-overview
      className={`${portal ? "absolute" : "fixed"} z-[25] flex flex-col overflow-hidden rounded-sm border border-subtle bg-surface-1 text-primary outline-none ${expanded ? "inset-0 m-4" : "top-0 right-0 bottom-0 w-full border-0 border-l md:w-[50%]"}`}
      style={{
        boxShadow:
          "0px 4px 8px 0px rgba(0, 0, 0, 0.12), 0px 6px 12px 0px rgba(16, 24, 40, 0.12), 0px 1px 16px 0px rgba(16, 24, 40, 0.12)",
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-3">
        <button
          type="button"
          aria-label="关闭弹窗"
          onClick={onClose}
          className="rounded p-1.5 text-secondary hover:bg-layer-1"
        >
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          aria-label={expanded ? "还原总览" : "展开总览"}
          onClick={() => setExpanded((value) => !value)}
          className="rounded p-1.5 text-secondary hover:bg-layer-1"
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <span className="ml-auto text-13 text-secondary">{title}</span>
      </header>
      <div className="vertical-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-5">{children}</div>
    </div>,
    portal ?? document.body
  );
}

const statusNames: Record<LabStatus, string> = {
  todo: "待做",
  active: "进行中",
  review: "待验收",
  done: "完成",
};
const priorityNames: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
  none: "无",
};
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function LabItemDetails({
  item,
  block,
  folderName,
  onClose,
  onSchedule,
  onAdjust,
  onEdit,
  busy = false,
}: {
  item: LabItem;
  block?: LabEvent;
  folderName?: string;
  onClose: () => void;
  onSchedule: () => void;
  onAdjust?: () => void;
  onEdit?: () => void;
  busy?: boolean;
}) {
  return (
    <LabItemOverviewSurface title="事项详情" onClose={onClose}>
      <div className="space-y-3">
        {item.issue_key && <p className="text-13 text-tertiary">{item.issue_key}</p>}
        <h2 className="text-20 font-semibold break-words">{item.title}</h2>
        {(item.bounty_id || item.is_bounty) && <LabBountyBadge color={item.category_color} />}
      </div>
      <section aria-label="事项内容" className="space-y-2">
        <h3 className="text-13 font-medium">事项内容</h3>
        <p className="text-14 leading-relaxed break-words whitespace-pre-wrap">{item.description || "暂无说明"}</p>
      </section>
      <h3 className="text-14 font-medium">属性</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-13">
        <div>
          <dt className="text-secondary">状态</dt>
          <dd className="mt-1">{statusNames[item.status]}</dd>
        </div>
        <div>
          <dt className="text-secondary">事项类别</dt>
          <dd className="mt-1 flex items-center gap-2 break-words">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.category_color ?? "#64748b" }}
            />
            {item.category_name ?? "未分类"}
          </dd>
        </div>
        <div>
          <dt className="text-secondary">文件夹</dt>
          <dd className="mt-1 break-words">{folderName ?? (item.folder_id ? "已归类" : "未分类")}</dd>
        </div>
        {!item.issue_id && (
          <div>
            <dt className="text-secondary">可见范围</dt>
            <dd className="mt-1 flex items-center gap-1.5">
              {item.public ? <Globe2 size={13} /> : <LockKeyhole size={13} />}
              {item.public ? "向负责人公开" : "仅自己可见"}
            </dd>
          </div>
        )}
        {item.project_name && (
          <div>
            <dt className="text-secondary">项目</dt>
            <dd className="mt-1 break-words">{item.project_name}</dd>
          </div>
        )}
        {item.issue_key && (
          <div>
            <dt className="text-secondary">任务编号</dt>
            <dd className="mt-1">{item.issue_key}</dd>
          </div>
        )}
        {item.priority && (
          <div>
            <dt className="text-secondary">优先级</dt>
            <dd className="mt-1">{priorityNames[item.priority] ?? item.priority}</dd>
          </div>
        )}
        {item.target_date && (
          <div>
            <dt className="text-secondary">截止日期</dt>
            <dd className="mt-1">
              <time dateTime={item.target_date}>{item.target_date}</time>
            </dd>
          </div>
        )}
        {item.archived && (
          <div>
            <dt className="text-secondary">归档</dt>
            <dd className="mt-1">已归档</dd>
          </div>
        )}
      </dl>
      {block && (
        <section aria-label="当前排期" className="space-y-2 rounded-lg border border-subtle p-3">
          <h3 className="flex items-center gap-2 text-13 font-medium">
            <Clock3 size={14} /> 当前排期
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 text-13 text-secondary">
            <time dateTime={block.start}>{timeFormat.format(new Date(block.start))}</time>
            <span>至</span>
            <time dateTime={block.end}>{timeFormat.format(new Date(block.end))}</time>
          </p>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        {onEdit && (
          <Button variant="neutral-primary" prependIcon={<Pencil size={14} />} onClick={onEdit} disabled={busy}>
            编辑事项
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          prependIcon={<CalendarDays size={14} />}
          onClick={onAdjust ?? onSchedule}
          disabled={busy}
        >
          {onAdjust ? "调整时间块" : "安排时间"}
        </Button>
      </div>
    </LabItemOverviewSurface>
  );
}
