/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { CalendarDays, Clock3, Globe2, LockKeyhole } from "lucide-react";
import type { LabEvent, LabItem, LabStatus } from "@plane/types";
import { Button, LabDialog } from "@plane/ui";

export type LabProjectIssueRef = { issue_id: string; project_id: string; archived?: boolean };
export type LabOpenProjectIssue = (issue: LabProjectIssueRef) => void;

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
}: {
  item: LabItem;
  block?: LabEvent;
  folderName?: string;
  onClose: () => void;
  onSchedule: () => void;
  onAdjust?: () => void;
}) {
  return (
    <LabDialog title="事项详情" busy={false} onClose={onClose}>
      <h2 className="text-18 font-semibold break-words">{item.title}</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-subtle bg-layer-1 p-3 text-13">
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
      <section aria-label="事项内容" className="space-y-2">
        <h3 className="text-13 font-medium">事项内容</h3>
        <p className="text-13 leading-relaxed break-words whitespace-pre-wrap text-secondary">
          {item.description || "暂无说明"}
        </p>
      </section>
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
      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          prependIcon={<CalendarDays size={14} />}
          onClick={onAdjust ?? onSchedule}
        >
          {onAdjust ? "调整时间块" : "安排时间"}
        </Button>
      </div>
    </LabDialog>
  );
}
