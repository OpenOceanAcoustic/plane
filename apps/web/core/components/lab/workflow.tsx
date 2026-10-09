/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { v4 as uuidv4 } from "uuid";
import { Background, Controls, Handle, Position, ReactFlow } from "@xyflow/react";
import type { NodeProps, ReactFlowInstance } from "@xyflow/react";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow requires its local component stylesheet.
import "./workflow.css";
import type { LabBounty } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import {
  Button,
  LabAmountInput,
  LabDialog,
  LabField,
  labAmountError,
  labDecimalText,
  labDecimalUnits,
  labInputClass,
} from "@plane/ui";
import { acceptanceLabels, workflowActionBody } from "./workflow-types";
import type { LabWorkflow, LabWorkflowAction } from "./workflow-types";
import { bountyWorkflowLayout } from "./workflow-layout";
import type { BountyWorkflowNode } from "./workflow-layout";

function BountyFlowNode({ id, data }: NodeProps<BountyWorkflowNode>) {
  return (
    <div
      className={`lab-workflow-node lab-bounty-node ${data.auxiliary ? "lab-bounty-node-auxiliary" : ""} rounded-lg border text-center text-13`}
      data-workflow-state={data.state}
      data-workflow-outcome={
        id === "done" ? "complete" : id === "rework" ? "rework" : id === "rejected" ? "rejected" : undefined
      }
    >
      {Object.entries({ left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }).map(
        ([side, position]) => (
          <div key={side}>
            <Handle type="target" id={`target-${side}`} position={position} />
            <Handle type="source" id={`source-${side}`} position={position} />
          </div>
        )
      )}
      <p className="font-medium">{data.label}</p>
      {data.state !== "upcoming" && (
        <span className="mt-1 block text-11">{data.state === "current" ? "当前阶段" : "已有记录"}</span>
      )}
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
  const [planned, setPlanned] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [showAllTransitions, setShowAllTransitions] = useState(false);
  const [flow, setFlow] = useState<ReactFlowInstance<BountyWorkflowNode>>();
  const canvas = useRef<HTMLDivElement>(null);
  const currentNode = data?.current_node;
  useEffect(() => {
    const element = canvas.current;
    if (!flow || !element || !currentNode) return;
    let frame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void flow.fitView({
          nodes: element.clientWidth < 960 ? [{ id: currentNode }] : undefined,
          padding: 0.15,
          minZoom: 0.65,
          maxZoom: 1,
        });
      });
    });
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [flow, currentNode]);
  const { nodes, edges } = data
    ? bountyWorkflowLayout(data, selectedNode, showAllTransitions)
    : { nodes: [], edges: [] };
  const actions = data?.actions.filter((action) => !selectedNode || action.node_id === selectedNode) ?? [];
  const history = data?.history.filter((event) => !selectedNode || event.node_id === selectedNode) ?? [];
  const newestHistory = Array.from({ length: history.length }, (_, index) => history[history.length - index - 1]!);
  const approved = bounty.allocations.filter((row) => row.approved);
  const budgetUnits = labDecimalUnits(bounty.budget);
  const approvedUnits = approved.reduce((sum, row) => sum + (labDecimalUnits(row.planned) ?? 0n), 0n);
  const claimAvailable =
    bounty.claim_available ??
    (budgetUnits === null ? undefined : labDecimalText(budgetUnits > approvedUnits ? budgetUnits - approvedUnits : 0n));
  const plannedError = labAmountError(planned, { limit: claimAvailable, min: "0.01", unit: "VC" });
  const hasTargets = !["rework", "reject"].includes(result);
  const targetErrors = approved.map((row) =>
    labAmountError(targets[row.id] ?? "", {
      min: ["pass", "negative"].includes(result) ? row.planned : row.awarded,
      limit: row.planned,
      unit: "VC",
    })
  );
  const targetUnits = approved.map((row) => labDecimalUnits(targets[row.id] ?? ""));
  const targetTotal = targetUnits.every((value) => value !== null)
    ? targetUnits.reduce<bigint>((sum, value) => sum + value!, 0n)
    : null;
  const targetsError =
    targetTotal !== null && budgetUnits !== null && targetTotal > budgetUnits
      ? `累计通过 VC 超过悬赏配额 ${bounty.budget} VC`
      : "";
  return (
    <section className="mt-4 rounded-md border border-subtle bg-layer-1 p-3" aria-label="悬赏流程图">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-14 font-semibold">团队悬赏流程</h3>
        {data && (
          <>
            <Button size="sm" variant="neutral-primary" onClick={() => setShowAllTransitions((value) => !value)}>
              {showAllTransitions ? "主流程" : "全部流转"}
            </Button>
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() =>
                void flow?.fitView({ nodes: [{ id: data.current_node }], padding: 0.7, maxZoom: 1, duration: 200 })
              }
            >
              当前阶段
            </Button>
          </>
        )}
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
          <div
            ref={canvas}
            className="lab-bounty-flow h-[430px] overflow-hidden rounded-md border border-subtle bg-surface-1"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.65}
              maxZoom={1.5}
              onInit={setFlow}
              onNodeClick={(_event, node) => setSelectedNode(node.id)}
              onPaneClick={() => setSelectedNode(undefined)}
              proOptions={{ hideAttribution: false }}
              aria-label="团队悬赏流程节点"
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
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
                  setPlanned("");
                  setTargets(Object.fromEntries(approved.map((row) => [row.id, row.planned])));
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
          submitDisabled={
            chosen.action === "claim"
              ? Boolean(plannedError)
              : chosen.action === "accept" && hasTargets
                ? Boolean(targetsError || targetErrors.some(Boolean))
                : false
          }
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
                <LabAmountInput
                  name="planned"
                  aria-label="计划 VC"
                  value={planned}
                  onValueChange={setPlanned}
                  min="0.01"
                  limit={claimAvailable}
                  unit="VC"
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
                approved.map((row) => (
                  <LabField
                    key={row.id}
                    label={`${row.name} 累计通过 VC（已授予 ${row.awarded}／计划 ${row.planned}）`}
                  >
                    <LabAmountInput
                      name={row.id}
                      aria-label={`${row.name} 累计通过 VC（已授予 ${row.awarded}／计划 ${row.planned}）`}
                      value={targets[row.id] ?? ""}
                      onValueChange={(value) => setTargets((previous) => ({ ...previous, [row.id]: value }))}
                      min={["pass", "negative"].includes(result) ? row.planned : row.awarded}
                      limit={row.planned}
                      unit="VC"
                      required
                    />
                  </LabField>
                ))}
              {hasTargets && targetsError && (
                <p role="alert" className="text-13 text-danger-primary">
                  {targetsError}
                </p>
              )}
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
