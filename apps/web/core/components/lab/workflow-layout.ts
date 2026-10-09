/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { Edge, Node } from "@xyflow/react";
import type { LabWorkflow } from "./workflow-types";

export type BountyWorkflowNode = Node<
  {
    label: string;
    state: "current" | "completed" | "upcoming";
    auxiliary: boolean;
  },
  "labBounty"
>;

const mainSequence = [
  "publication",
  "publication_review",
  "claim",
  "confirm",
  "active",
  "submit",
  "acceptance",
  "major_review",
  "done",
];
const outcomeNodes = new Set(["partial", "rework", "rejected"]);
const auxiliaryNodes = new Set(["cancelled", "deleted", "reversal"]);
const spacing = 188;

/** Preserve server business nodes and relationships; lay out the normal path independently of its return paths. */
export function bountyWorkflowLayout(workflow: LabWorkflow, selected?: string, showAll = false) {
  const ids = new Set(workflow.nodes.map((node) => node.id));
  const main = mainSequence.filter((id) => ids.has(id));
  const index = new Map(main.map((id, position) => [id, position]));
  const outcomeSource = ids.has("major_review") ? "major_review" : "acceptance";
  const outcomeX = (index.get(outcomeSource) ?? main.length - 1) * spacing;
  const positions: Record<string, { x: number; y: number }> = {
    partial: { x: outcomeX - spacing, y: 170 },
    rework: { x: outcomeX, y: 170 },
    rejected: { x: outcomeX + spacing, y: 170 },
    deleted: { x: 0, y: 304 },
    cancelled: { x: spacing, y: 304 },
    reversal: { x: (main.length - 1) * spacing, y: 304 },
  };
  const nodes: BountyWorkflowNode[] = workflow.nodes.map((node) => ({
    id: node.id,
    type: "labBounty",
    position: index.has(node.id)
      ? { x: index.get(node.id)! * spacing, y: 20 }
      : (positions[node.id] ?? { x: node.x, y: node.y }),
    data: { label: node.label, state: node.state, auxiliary: auxiliaryNodes.has(node.id) },
    selected: node.id === selected,
  }));
  const edges: Edge[] = workflow.edges.flatMap((edge) => {
    const mainEdge = index.has(edge.source) && index.get(edge.target) === index.get(edge.source)! + 1;
    const outcomeEdge = edge.source === outcomeSource && outcomeNodes.has(edge.target);
    const primary = mainEdge || outcomeEdge;
    const focused = edge.source === selected || edge.target === selected;
    if (
      !primary &&
      !showAll &&
      !focused &&
      edge.source !== workflow.current_node &&
      edge.target !== workflow.current_node
    )
      return [];
    let sourceSide = "bottom";
    let targetSide = "top";
    if (mainEdge) {
      sourceSide = "right";
      targetSide = "left";
    } else if (edge.target === "submit" || edge.target === "acceptance") {
      sourceSide = "left";
      targetSide = "bottom";
    } else if (edge.source === "partial" && edge.target === "reversal") {
      sourceSide = "bottom";
      targetSide = "left";
    }
    return [
      {
        ...edge,
        sourceHandle: `source-${sourceSide}`,
        targetHandle: `target-${targetSide}`,
        type: mainEdge ? "straight" : "default",
        className: focused
          ? "lab-bounty-edge-focused"
          : primary
            ? "lab-bounty-edge-primary"
            : "lab-bounty-edge-secondary",
        animated: edge.target === workflow.current_node,
        style: { strokeWidth: focused ? 1.8 : primary ? 1.5 : 1 },
      },
    ];
  });
  return { nodes, edges };
}
