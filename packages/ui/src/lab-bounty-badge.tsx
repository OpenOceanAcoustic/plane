/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { CSSProperties } from "react";
import { Star } from "lucide-react";

/** Category colors belong to the viewer. This marker adds emphasis without replacing them. */
export function labBountyOutline(color?: string | null): CSSProperties {
  return { borderColor: color || "#8b5cf6", boxShadow: `inset 0 0 0 1px ${color || "#8b5cf6"}` };
}

export function LabBountyBadge({ color, compact = false }: { color?: string | null; compact?: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-11 font-semibold"
      style={{ color: color || "#8b5cf6", backgroundColor: `${color || "#8b5cf6"}18` }}
      aria-label="悬赏任务"
    >
      <Star size={compact ? 10 : 12} fill="currentColor" aria-hidden />
      <span>悬赏</span>
    </span>
  );
}
