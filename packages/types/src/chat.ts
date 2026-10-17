/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { TIssueComment, TCommentsOperations } from "./issues/activity/issue_comment";

/** Only presentation fields; project/work-item identities belong to the conversation. */
export type TComment = Pick<
  TIssueComment,
  | "id"
  | "workspace"
  | "actor"
  | "actor_detail"
  | "created_at"
  | "updated_at"
  | "edited_at"
  | "comment_html"
  | "comment_json"
  | "comment_stripped"
  | "access"
  | "attachments"
  | "comment_reactions"
> & { parent_id?: string | null; can_edit?: boolean; can_delete?: boolean };

export type TCommentOperations = {
  createComment: (data: Partial<TComment>) => Promise<Partial<TComment> | undefined>;
  updateComment: (id: string, data: Partial<TComment>) => Promise<void>;
  removeComment: (id: string) => Promise<void>;
  copyCommentLink: (id: string) => void;
} & Partial<Omit<TCommentsOperations, "createComment" | "updateComment" | "removeComment" | "copyCommentLink">>;

export type ChatScope = "workspace" | "project" | "issue";
export type ChatThread = {
  id: string;
  workspace: string;
  scope: ChatScope;
  title: string;
  project_id: string | null;
  issue_id: string | null;
  can_write: boolean;
  unread_count: number;
  activity_at: string;
  preview: string;
};
export type ChatIssueReference = {
  id: string;
  accessible: boolean;
  title?: string;
  key?: string;
  project_id?: string;
};
export type ChatMessage = TComment & { thread_id: string; references: Record<string, ChatIssueReference> };
export type ChatMessagePage = {
  messages: ChatMessage[];
  next_cursor?: string | null;
  sync_cursor: string | null;
  continue_cursor?: string | null;
  end_cursor?: string | null;
  can_write?: boolean;
  has_newer?: boolean;
};
export type ChatReferenceResults = {
  users: { id: string; display_name: string; avatar_url: string }[];
  issues: ChatIssueReference[];
};
