/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { Link } from "react-router";
import { LabBountyBadge } from "@plane/ui";
import { LabTaskDocuments } from "./documents";
import { LabIssueFields } from "./field-manager";
import { useLabTaskCardMetadataState } from "./use-task-card-metadata";

export function LabIssueDetails({
  workspaceSlug,
  projectId,
  issueId,
  editable = false,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  editable?: boolean;
}) {
  const { data, error, isValidating } = useLabTaskCardMetadataState(workspaceSlug, projectId, true);
  const metadata = !error && !isValidating ? data?.get(issueId) : undefined;
  return (
    <>
      {metadata?.bounty_id && metadata.bounty_status !== "deleted" && metadata.bounty_budget != null && (
        <section aria-label="悬赏" className="flex flex-wrap items-center gap-4 rounded-md border border-subtle p-4">
          <LabBountyBadge color={metadata.color ?? undefined} />
          <dl className="flex items-center gap-2 text-13">
            <dt className="text-secondary">VC配额</dt>
            <dd className="font-medium">{metadata.bounty_budget} VC</dd>
          </dl>
          <Link
            to={`/${workspaceSlug}/lab/bounties?bounty_id=${encodeURIComponent(metadata.bounty_id)}`}
            className="ml-auto text-13 text-accent-primary"
          >
            打开悬赏大厅
          </Link>
        </section>
      )}
      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          悬赏信息读取失败
        </p>
      )}
      <LabIssueFields
        key={`${projectId}:${issueId}`}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        editable={editable}
      />
      <LabTaskDocuments workspaceSlug={workspaceSlug} projectId={projectId} issueId={issueId} />
    </>
  );
}
