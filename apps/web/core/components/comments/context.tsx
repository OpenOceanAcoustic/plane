/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createContext, useContext } from "react";
import type { TMentionHandler } from "@plane/editor";
import type { ChatIssueReference, TComment } from "@plane/types";

export type CommentContextValue = {
  mentionHandler?: TMentionHandler;
  uploads?: boolean;
  onReply?: (comment: TComment) => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
  submitLabel?: string;
  issueReferences?: Record<string, ChatIssueReference>;
  onOpenIssue?: (reference: ChatIssueReference) => void;
};
export const CommentContext = createContext<CommentContextValue>({});
export const useCommentContext = () => useContext(CommentContext);
