/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { v4 as uuidv4 } from "uuid";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow requires its local component stylesheet.
import "./workflow.css";
import type { LabBounty } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";
import { acceptanceLabels, workflowActionBody } from "./workflow-types";
import type { LabWorkflow, LabWorkflowAction } from "./workflow-types";

type WorkflowNode = Node<{ label: string; state: "current" | "completed" | "upcoming" }, "labBounty">;

function BountyFlowNode({ data }: NodeProps<WorkflowNode>) {
  return (
    <div
      className={`shadow-sm min-w-44 rounded-lg border px-4 py-3 text-center text-13 ${data.state === "current" ? "border-accent-strong bg-accent-primary/10 text-accent-primary" : data.state === "completed" ? "border-subtle bg-layer-1 text-primary" : "border-subtle bg-surface-1 text-tertiary"}`}
    >
      <Handle type="target" position={Position.Left} />
      <p className="font-medium">{data.label}</p>
      {data.state !== "upcoming" && (
        <span className="mt-1 block text-11">{data.state === "current" ? "当前阶段" : "已有记录"}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { labBounty: BountyFlowNode };

export const LabBountyWorkflow = observer(function LabBountyWorkflow({
  store,
  bounty,
}: {
  store: LabStore;
  bounty: LabBounty;
}) {
  const revision = `${bounty.status}:${bounty.awarded}:${bounty.allocations.map((row) => `${row.id}-${row.approved}-${row.confirmed}-${row.closed}`).join(",")}:${bounty.acceptances.map((row) => `${row.id}-${row.approved_at}`).join(",")}`;
  const { data, error, mutate, isLoading } = useSWR(
    ["lab-bounty-workflow", store.slug, bounty.id, revision],
    () => store.request<LabWorkflow>(`bounties/${bounty.id}/workflow/`),
    { refreshInterval: 30000 }
  );
  const [chosen, setChosen] = useState<LabWorkflowAction>();
  const [result, setResult] = useState("pass");
  const [requestKey, setRequestKey] = useState("");
  const [selectedNode, setSelectedNode] = useState<string>();
  const nodes: WorkflowNode[] =
    data?.nodes.map((node) => ({
      id: node.id,
      type: "labBounty",
      position: { x: node.x, y: node.y },
      data: { label: node.label, state: node.state },
    })) ?? [];
  const edges = data?.edges.map((edge) => ({ ...edge, animated: edge.target === data.current_node })) ?? [];
  const actions = data?.actions.filter((action) => !selectedNode || action.node_id === selectedNode) ?? [];
  const history = data?.history.filter((event) => !selectedNode || event.node_id === selectedNode) ?? [];
  const newestHistory = Array.from({ length: history.length }, (_, index) => history[history.length - index - 1]!);
  return (
    <section className="mt-4 rounded-md border border-subtle bg-layer-1 p-3" aria-label="悬赏流程图">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-14 font-semibold">团队悬赏流程</h3>
        {selectedNode && (
          <Button size="sm" variant="neutral-primary" onClick={() => setSelectedNode(undefined)}>
            查看全部节点
          </Button>
        )}
        <Button size="sm" variant="neutral-primary" onClick={() => void mutate()}>
          刷新
        </Button>
      </div>
      {isLoading && <p className="py-4 text-12 text-secondary">正在加载流程…</p>}
      {error && (
        <p role="alert" className="text-12 text-danger-primary">
          {error instanceof Error ? error.message : "流程加载失败"}
        </p>
      )}
      {data && (
        <>
          <div className="lab-bounty-flow h-[430px] overflow-hidden rounded-md border border-subtle bg-surface-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.3}
              maxZoom={1.5}
              onNodeClick={(_event, node) => setSelectedNode(node.id)}
              onPaneClick={() => setSelectedNode(undefined)}
              proOptions={{ hideAttribution: false }}
              aria-label="团队悬赏流程节点"
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  node.id === data.current_node
                    ? "var(--background-color-accent-primary)"
                    : "var(--background-color-layer-3)"
                }
              />
            </ReactFlow>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="当前可执行动作">
            {actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="neutral-primary"
                disabled={!action.enabled || store.busy}
                title={action.reason || action.label}
                onClick={() => {
                  setChosen(action);
                  setResult("pass");
                  setRequestKey(uuidv4());
                }}
              >
                {action.label}
              </Button>
            ))}
            {actions.length === 0 && <p className="text-12 text-tertiary">此阶段暂无您可执行的操作。</p>}
            {actions
              .filter((action) => !action.enabled)
              .map((action) => (
                <p key={`${action.id}-reason`} className="w-full text-12 text-secondary">
                  {action.reason}
                </p>
              ))}
          </div>
          <details className="mt-3 text-12" open={Boolean(selectedNode)}>
            <summary className="cursor-pointer font-medium">
              {selectedNode ? "所选节点" : "流程"}记录（{history.length}）
            </summary>
            <ol className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
              {newestHistory.map((event) => (
                <li key={event.id} className="rounded bg-surface-1 p-2">
                  <p>
                    <strong>{event.label}</strong> · {event.actor} ·{" "}
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                    </time>
                  </p>
                  {event.result && <p className="mt-1">{acceptanceLabels[event.result] ?? event.result}</p>}
                  {event.reason && <p className="mt-1 whitespace-pre-wrap text-secondary">{event.reason}</p>}
                </li>
              ))}
              {history.length === 0 && <li className="text-tertiary">暂无记录。</li>}
            </ol>
          </details>
        </>
      )}
      {chosen && (
        <LabDialog
          title={chosen.label}
          busy={store.busy}
          onClose={() => setChosen(undefined)}
          onSubmit={(form) =>
            store.execute(async () => {
              const body = workflowActionBody(chosen, form, bounty, result, requestKey);
              await store.request(
                chosen.action === "reverse"
                  ? `ledger/${chosen.body.ledger_id}/reverse/`
                  : `bounties/${bounty.id}/${chosen.action}/`,
                "POST",
                body
              );
              await store.loadMarket();
              await store.loadPlanner();
              await mutate();
              setChosen(undefined);
            })
          }
        >
          {chosen.action === "claim" && (
            <>
              <LabField label="本人交付物">
                <textarea name="deliverable" className={labInputClass} required />
              </LabField>
              <LabField label="计划 VC">
                <input
                  name="planned"
                  type="number"
                  min="0.01"
                  max={bounty.budget}
                  step="0.01"
                  className={labInputClass}
                  required
                />
              </LabField>
            </>
          )}
          {chosen.action === "submit" && (
            <LabField label="成果、附件链接、探索记录">
              <textarea name="evidence" className={labInputClass} rows={5} required defaultValue={bounty.evidence} />
            </LabField>
          )}
          {chosen.action === "accept" && (
            <>
              <LabField label="验收结果">
                <select className={labInputClass} value={result} onChange={(event) => setResult(event.target.value)}>
                  {Object.entries(acceptanceLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </LabField>
              {!["rework", "reject"].includes(result) &&
                bounty.allocations
                  .filter((row) => row.approved)
                  .map((row) => (
                    <LabField
                      key={row.id}
                      label={`${row.name} 累计通过 VC（已授予 ${row.awarded}／计划 ${row.planned}）`}
                    >
                      <input
                        name={row.id}
                        type="number"
                        min={row.awarded}
                        max={row.planned}
                        step="0.01"
                        defaultValue={row.planned}
                        className={labInputClass}
                        required
                      />
                    </LabField>
                  ))}
            </>
          )}
          {["accept", "publication-review", "acceptance-review", "cancel", "reopen", "reverse"].includes(
            chosen.action
          ) && (
            <LabField label="处理意见">
              <textarea name="reason" className={labInputClass} rows={4} required />
            </LabField>
          )}
          {["start", "approve", "confirm"].includes(chosen.action) && (
            <p className="text-13">确认执行“{chosen.label}”？</p>
          )}
          {store.error && (
            <p role="alert" className="text-12 text-danger-primary">
              {store.error}
            </p>
          )}
        </LabDialog>
      )}
    </section>
  );
});
