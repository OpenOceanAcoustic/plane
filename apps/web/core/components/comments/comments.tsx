/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import type { ReactNode, RefObject, UIEventHandler } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { E_SORT_ORDER } from "@plane/constants";
import type { TCommentOperations, TComment } from "@plane/types";
// local components
import { CommentCard } from "./card/root";
import { CommentCreate } from "./comment-create";

type TCommentsWrapper = {
  projectId?: string;
  entityId: string;
  isEditingAllowed?: boolean;
  activityOperations: TCommentOperations;
  comments: TComment[] | string[];
  sortOrder?: E_SORT_ORDER;
  getCommentById?: (activityId: string) => TComment | undefined;
  showAccessSpecifier?: boolean;
  showCopyLinkOption?: boolean;
  enableReplies?: boolean;
  composerPosition?: "top" | "bottom";
  scrollRef?: RefObject<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  historyHeader?: ReactNode;
  composerHeader?: ReactNode;
  messagePrefix?: (comment: TComment) => ReactNode;
};

export const CommentsWrapper = observer(function CommentsWrapper(props: TCommentsWrapper) {
  const {
    entityId,
    activityOperations,
    comments,
    getCommentById,
    isEditingAllowed = true,
    projectId,
    showAccessSpecifier = false,
    showCopyLinkOption = false,
    enableReplies = false,
    composerPosition = "top",
    scrollRef,
    onScroll,
    historyHeader,
    composerHeader,
    messagePrefix,
  } = props;
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  const renderCommentCreate = useMemo(
    () =>
      isEditingAllowed && (
        <CommentCreate
          workspaceSlug={workspaceSlug}
          entityId={entityId}
          activityOperations={activityOperations}
          projectId={projectId}
          showToolbarInitially={composerPosition === "bottom"}
        />
      ),
    [isEditingAllowed, workspaceSlug, entityId, activityOperations, projectId, composerPosition]
  );

  return (
    <div className="relative flex h-full flex-col gap-y-2 overflow-hidden">
      {composerPosition === "top" && renderCommentCreate}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-grow overflow-y-auto py-4"
        role="log"
        aria-label="消息记录"
        aria-live="polite"
      >
        {historyHeader}
        {comments?.map((data, index) => {
          let comment;
          if (typeof data === "string") {
            comment = getCommentById?.(data);
          } else {
            comment = data;
          }

          if (!comment) return null;
          return (
            <div key={comment.id} data-message-id={comment.id}>
              {messagePrefix?.(comment)}
              <CommentCard
                workspaceSlug={workspaceSlug}
                entityId={entityId}
                comment={comment}
                activityOperations={activityOperations}
                disabled={!isEditingAllowed}
                ends={index === 0 ? "top" : index === comments.length - 1 ? "bottom" : undefined}
                projectId={projectId}
                showAccessSpecifier={showAccessSpecifier}
                showCopyLinkOption={showCopyLinkOption}
                enableReplies={enableReplies}
              />
            </div>
          );
        })}
      </div>
      {composerPosition === "bottom" && (
        <div className="shrink-0 border-t border-subtle pt-2">
          {composerHeader}
          {renderCommentCreate}
        </div>
      )}
    </div>
  );
});
