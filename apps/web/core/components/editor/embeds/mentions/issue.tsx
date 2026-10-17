/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from "react";
import { useParams } from "react-router";
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import type { ChatIssueReference } from "@plane/types";
import { useCommentContext } from "@/components/comments/context";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

export function EditorIssueMention({ id }: { id: string }) {
  const { workspaceSlug = "" } = useParams();
  const context = useCommentContext();
  const { setPeekIssue } = useIssueDetail();
  const store = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const { data, error } = useSWR(
    context.issueReferences ? null : ["chat-reference", workspaceSlug, id],
    () => store.request<Record<string, ChatIssueReference>>(`chat/references/?id=${encodeURIComponent(id)}`),
    { refreshInterval: 30000 }
  );
  const reference = context.issueReferences?.[id] ?? data?.[id];
  if (error || !reference?.accessible || !reference.project_id) {
    return <span className="not-prose inline rounded-sm bg-layer-1 px-1 py-0.5 text-tertiary">工作项不可访问</span>;
  }
  return (
    <button
      type="button"
      className="not-prose inline rounded-sm bg-accent-subtle-active px-1 py-0.5 text-accent-primary"
      onClick={(event) => {
        event.preventDefault();
        if (context.onOpenIssue) context.onOpenIssue(reference);
        else setPeekIssue({ workspaceSlug, projectId: reference.project_id!, issueId: reference.id });
      }}
    >
      @{reference.key} {reference.title}
    </button>
  );
}
