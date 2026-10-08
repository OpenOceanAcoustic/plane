/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";

type TaskCardMetadata = {
  issue_id: string;
  bounty_id: string | null;
  bounty_status: string | null;
  color: string | null;
  detail_path: string | null;
};
const emptyMetadata: ReadonlyMap<string, TaskCardMetadata> = new Map();

/** All cards in a project share one permission-filtered request. */
export function useLabTaskCardMetadata(workspaceSlug: string | undefined, projectId: string | null | undefined) {
  const key = workspaceSlug && projectId ? (["lab-task-card-metadata", workspaceSlug, projectId] as const) : null;
  const { data } = useSWR(
    key,
    async ([, slug, project]: readonly [string, string, string]) => {
      const response = await fetch(
        `${API_BASE_URL}/api/workspaces/${encodeURIComponent(slug)}/lab/task-card-metadata/?project_id=${encodeURIComponent(project)}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("工作项标记暂时无法读取");
      const result = (await response.json()) as { items: TaskCardMetadata[] };
      return new Map(result.items.map((item) => [item.issue_id, item]));
    },
    { refreshInterval: 30000, shouldRetryOnError: false }
  );
  return data ?? emptyMetadata;
}
