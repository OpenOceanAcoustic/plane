/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import type { LabTaskCardMetadata } from "@plane/types";

const emptyMetadata: ReadonlyMap<string, LabTaskCardMetadata> = new Map();

/** All cards in a project share one permission-filtered request. */
export function useLabTaskCardMetadataState(
  workspaceSlug: string | undefined,
  projectId: string | null | undefined,
  revalidateOnMount = false
) {
  const key = workspaceSlug && projectId ? (["lab-task-card-metadata", workspaceSlug, projectId] as const) : null;
  return useSWR(
    key,
    async ([, slug, project]: readonly [string, string, string]) => {
      const response = await fetch(
        `${API_BASE_URL}/api/workspaces/${encodeURIComponent(slug)}/lab/task-card-metadata/?project_id=${encodeURIComponent(project)}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("工作项标记暂时无法读取");
      const result = (await response.json()) as { items: LabTaskCardMetadata[] };
      return new Map(result.items.map((item) => [item.issue_id, item]));
    },
    {
      refreshInterval: 30000,
      shouldRetryOnError: false,
      ...(revalidateOnMount ? { revalidateOnMount: true, dedupingInterval: 0 } : {}),
    }
  );
}

export function useLabTaskCardMetadata(workspaceSlug: string | undefined, projectId: string | null | undefined) {
  const { data } = useLabTaskCardMetadataState(workspaceSlug, projectId);
  return data ?? emptyMetadata;
}
