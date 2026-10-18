/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from "react";
import useSWR from "swr";
import { X } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import type { LabWorkload } from "@plane/types";

async function fetchWorkload([, slug]: readonly [string, string]) {
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${encodeURIComponent(slug)}/lab/me/workload/`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("并行任务统计暂不可用");
  return response.json() as Promise<LabWorkload>;
}

export function LabWorkloadNotice({ workspaceSlug, refreshKey = "" }: { workspaceSlug: string; refreshKey?: string }) {
  const { data, error, mutate } = useSWR(["lab-workload", workspaceSlug], fetchWorkload, {
    refreshInterval: 5000,
    shouldRetryOnError: false,
  });
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    if (data && !data.overloaded) setDismissed("");
  }, [data]);
  useEffect(() => {
    void mutate();
  }, [refreshKey, mutate]);
  const signature = data
    ? `${workspaceSlug}:${data.active}:${data.major}:${data.active_limit}:${data.major_limit}`
    : "";
  if (error || !data?.overloaded || signature === dismissed) return null;
  return (
    <div
      role="status"
      aria-label="并行任务提醒"
      className="flex items-start gap-3 rounded border border-warning-strong/30 bg-warning-subtle/10 p-3 text-13 text-primary"
    >
      <p className="flex-1">{data.message}</p>
      <button
        type="button"
        aria-label="关闭并行任务提醒"
        className="rounded p-1 text-secondary hover:bg-layer-1"
        onClick={() => setDismissed(signature)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
