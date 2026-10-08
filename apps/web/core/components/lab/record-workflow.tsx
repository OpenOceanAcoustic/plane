/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import useSWR from "swr";
import { Background, Controls, Handle, Position, ReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import type { LabStore } from "@plane/shared-state";
import type { LabRecordWorkflow, LabRecordWorkflowAction } from "@plane/types";
import { Button } from "@plane/ui";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow local stylesheet.
import "./workflow.css";

type RecordNode = Node<{ label: string; state: "current" | "completed" | "upcoming" }, "labRecord">;
function RecordFlowNode({ data }: NodeProps<RecordNode>) {
  return (
    <div
      className={`min-w-40 rounded-lg border px-4 py-3 text-center text-13 ${data.state === "current" ? "border-accent-strong bg-accent-primary/10" : "border-subtle bg-surface-1"}`}
    >
      <Handle type="target" position={Position.Left} />
      <p className="font-medium">{data.label}</p>
      <p className="mt-1 text-11 text-secondary">
        {data.state === "current" ? "当前可办理" : data.state === "completed" ? "已有记录" : "尚未发生"}
      </p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { labRecord: RecordFlowNode };

export function LabRecordWorkflowView({
  store,
  projectId,
  scope,
  revision = 0,
  onAction,
}: {
  store: LabStore;
  projectId: string;
  scope: "project" | "finance";
  revision?: number;
  onAction: (action: LabRecordWorkflowAction) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const path =
    scope === "project"
      ? `projects/${projectId}/workflow/`
      : `finance/workflow/${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR(["lab-record-workflow", store.slug, path, revision], () =>
    store.request<LabRecordWorkflow>(path)
  );
  const nodes: RecordNode[] =
    data?.nodes.map((node) => ({
      id: node.id,
      type: "labRecord",
      position: { x: node.x, y: node.y },
      data: { label: node.label, state: node.state },
    })) ?? [];
  const events = data?.history.filter((event) => !selected || event.node_id === selected) ?? [];
  const newestEvents = Array.from({ length: events.length }, (_, index) => events[events.length - index - 1]!);
  return (
    <section
      aria-label={scope === "project" ? "项目流程图" : "资金流程图"}
      className="space-y-3 rounded-lg border border-subtle p-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-14 font-semibold">
          {data?.title ?? (scope === "project" ? "项目流程" : "资金流程")}
        </h2>
        {selected && (
          <Button size="sm" variant="neutral-primary" onClick={() => setSelected(undefined)}>
            全部节点
          </Button>
        )}
        <Button size="sm" variant="neutral-primary" onClick={() => void mutate()}>
          刷新流程
        </Button>
      </div>
      {isLoading && <p className="text-13 text-secondary">正在加载记录…</p>}
      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          {error instanceof Error ? error.message : "流程加载失败"}
        </p>
      )}
      {data && (
        <>
          <div className="lab-bounty-flow h-[400px] rounded-lg border border-subtle">
            <ReactFlow
              nodes={nodes}
              edges={data.edges.map((edge) => ({ ...edge, animated: data.active_node_ids.includes(edge.target) }))}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              fitView
              onNodeClick={(_, node) => setSelected(node.id)}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.actions
              .filter((action) => !selected || action.node_id === selected)
              .map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  disabled={!action.enabled || store.busy}
                  title={action.reason || undefined}
                  onClick={() => onAction(action)}
                >
                  {action.label}
                </Button>
              ))}
          </div>
          <div className="max-h-72 space-y-2 overflow-auto">
            {newestEvents.map((event) => (
              <article key={event.id} className="rounded border border-subtle bg-layer-1 p-3 text-12">
                <p className="font-medium">
                  {event.label} · {event.actor || "历史记录"} ·{" "}
                  <time dateTime={event.created_at}>
                    {new Date(event.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                  </time>
                </p>
                {event.occurred_at && event.occurred_at !== event.created_at && (
                  <p className="mt-1 text-secondary">
                    事实发生于 {new Date(event.occurred_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                    ；上述时间为登记时间。
                  </p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-secondary">{event.reason}</p>
                {event.evidence && <p className="mt-1 whitespace-pre-wrap text-secondary">凭证：{event.evidence}</p>}
                {event.snapshot && (
                  <details className="mt-1">
                    <summary className="cursor-pointer">查看计算与业务快照</summary>
                    <pre className="mt-1 overflow-auto rounded bg-surface-1 p-2 text-11">
                      {JSON.stringify(event.snapshot, null, 2)}
                    </pre>
                  </details>
                )}
                {event.source && (
                  <a
                    className="mt-1 inline-block text-accent-primary"
                    target="_blank"
                    rel="noreferrer"
                    href={event.source.path}
                  >
                    {event.source.label}
                  </a>
                )}
              </article>
            ))}
          </div>
          {!events.length && <p className="text-12 text-secondary">当前节点暂无有证据支持的历史记录。</p>}
        </>
      )}
    </section>
  );
}
