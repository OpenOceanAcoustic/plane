/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { Avatar } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { API_BASE_URL } from "@plane/constants";
import { ChatStore } from "@plane/shared-state";
import { EditorMentionsRoot } from "@/components/editor/embeds/mentions";
import { CommentContext } from "./context";

/** Give legacy comment inputs the same permission-filtered picker as the chat center. */
export function WorkItemCommentContext({
  workspaceSlug,
  issueId,
  children,
  enabled = true,
}: {
  workspaceSlug: string;
  issueId: string;
  children: ReactNode;
  enabled?: boolean;
}) {
  const store = useMemo(() => new ChatStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const handler = useMemo(
    () => ({
      renderComponent: EditorMentionsRoot,
      searchCallback: async (query: string) => {
        const thread = await store.resolve("issue", issueId);
        const data = await store.references(thread.id, query);
        return [
          {
            key: "users",
            title: "成员",
            items: data.users.map((user) => ({
              id: user.id,
              entity_identifier: user.id,
              entity_name: "user_mention" as const,
              title: user.display_name,
              icon: <Avatar name={user.display_name} src={getFileURL(user.avatar_url)} />,
            })),
          },
          {
            key: "issues",
            title: "工作项",
            items: data.issues.map((issue) => ({
              id: issue.id,
              entity_identifier: issue.id,
              entity_name: "issue" as const,
              title: `${issue.key} ${issue.title}`,
              icon: <MessageSquare size={14} />,
            })),
          },
        ];
      },
    }),
    [store, issueId]
  );
  const context = useMemo(() => ({ mentionHandler: handler }), [handler]);
  return enabled ? <CommentContext.Provider value={context}>{children}</CommentContext.Provider> : <>{children}</>;
}
