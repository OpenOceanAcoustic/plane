/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router";
import { useSWRConfig } from "swr";
import { Star } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import type { LabTask } from "@plane/types";
import { Button, LabBountyBadge } from "@plane/ui";
import { LabBountyPublish } from "./bounty-publish";
import { LabTaskDocuments } from "./documents";
import { LabIssueFields } from "./field-manager";
import { useLabTaskCardMetadataState } from "./use-task-card-metadata";

export const LabIssueDetails = observer(function LabIssueDetails({
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
  const store = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const [publishing, setPublishing] = useState<{ task: LabTask; requestId: number }>();
  const requestId = useRef(0);
  const publishAllowed = useRef(false);
  const { mutate } = useSWRConfig();
  const { data, error, isValidating } = useLabTaskCardMetadataState(workspaceSlug, projectId, true);
  const metadata = !error && !isValidating ? data?.get(issueId) : undefined;
  const currentMetadata = data?.get(issueId);
  const publishingAllowed =
    editable && !error && currentMetadata?.can_publish_bounty === true && !currentMetadata.bounty_id;
  publishAllowed.current = publishingAllowed;
  const canPublish = publishingAllowed && !isValidating;
  const invalidateRequest = useCallback(() => {
    ++requestId.current;
  }, []);
  useEffect(() => {
    invalidateRequest();
    setPublishing(undefined);
    store.error = "";
    return invalidateRequest;
  }, [workspaceSlug, projectId, issueId, editable, store, invalidateRequest]);
  useEffect(() => {
    if (!publishingAllowed) {
      invalidateRequest();
      setPublishing(undefined);
    }
  }, [publishingAllowed, invalidateRequest]);
  async function openPublish() {
    if (!canPublish || store.busy) return;
    const currentRequest = ++requestId.current;
    await store.execute(async () => {
      try {
        const search = new URLSearchParams({ project_id: projectId, publishable: "1", issue_id: issueId });
        const [, tasks] = await Promise.all([store.loadPlanner(), store.request<LabTask[]>(`tasks/?${search}`)]);
        if (currentRequest !== requestId.current || !publishAllowed.current) return;
        const task = tasks.find((row) => row.id === issueId && row.project_id === projectId);
        if (!task) throw new Error("此工作项当前不可发布悬赏，请刷新后重试");
        setPublishing({ task, requestId: currentRequest });
      } catch (failure) {
        if (currentRequest === requestId.current && publishAllowed.current) throw failure;
      }
    });
  }
  return (
    <>
      {canPublish && (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" disabled={store.busy} onClick={() => void openPublish()}>
            <Star size={14} className="mr-1" aria-hidden="true" />
            发布悬赏
          </Button>
        </div>
      )}
      {store.error && (
        <p role="alert" className="text-13 text-danger-primary">
          {store.error}
        </p>
      )}
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
      {publishing?.task.id === issueId && publishing.task.project_id === projectId && publishingAllowed && (
        <LabBountyPublish
          store={store}
          fixedTask={publishing.task}
          onClose={() => {
            if (requestId.current === publishing.requestId) setPublishing(undefined);
          }}
          onPublished={async () => {
            if (requestId.current === publishing.requestId) setPublishing(undefined);
            await mutate(["lab-task-card-metadata", workspaceSlug, projectId]).catch(() => undefined);
          }}
        />
      )}
    </>
  );
});
