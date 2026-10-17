/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useForm } from "react-hook-form";
import type { EditorRefApi } from "@plane/editor";
import { CheckIcon, CloseIcon } from "@plane/propel/icons";
// plane imports
import type { TCommentOperations, TComment } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";

type Props = {
  activityOperations: TCommentOperations;
  comment: TComment;
  isEditing: boolean;
  projectId?: string;
  readOnlyEditorRef: EditorRefApi | null;
  setIsEditing: (isEditing: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
};

export const CommentCardEditForm = observer(function CommentCardEditForm(props: Props) {
  const {
    activityOperations,
    comment,
    isEditing,
    projectId,
    readOnlyEditorRef,
    setIsEditing,
    workspaceId,
    workspaceSlug,
  } = props;
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  const [errorMessage, setError] = useState("");
  // form info
  const {
    formState: { isSubmitting },
    handleSubmit,
    setFocus,
    watch,
    setValue,
  } = useForm<Partial<TComment>>({
    defaultValues: { comment_html: comment?.comment_html },
  });
  const commentHTML = watch("comment_html");

  const isEmpty = isCommentEmpty(commentHTML);
  const isEditorReadyToDiscard = editorRef.current?.isEditorReadyToDiscard();
  const isSubmitButtonDisabled = isSubmitting || !isEditorReadyToDiscard;
  const isDisabled = isSubmitting || isEmpty || isSubmitButtonDisabled;

  const onEnter = async (formData: Partial<TComment>) => {
    if (isSubmitting || !comment) return;

    try {
      setError("");
      await activityOperations.updateComment(comment.id, formData);
      readOnlyEditorRef?.setEditorValue(formData?.comment_html ?? "<p></p>");
      setIsEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "修改失败，请重试");
    }
  };

  useEffect(() => {
    if (isEditing) {
      setFocus("comment_html");
    }
  }, [isEditing, setFocus]);

  return (
    <form className="flex flex-col gap-2">
      {errorMessage && (
        <p role="alert" className="text-13 text-danger-primary">
          {errorMessage}
        </p>
      )}
      <div
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.defaultPrevented &&
            !e?.nativeEvent?.isComposing &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !isEmpty
          )
            handleSubmit(onEnter)(e);
        }}
      >
        <LiteTextEditor
          editable
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          ref={editorRef}
          id={comment.id}
          initialValue={commentHTML ?? ""}
          value={null}
          onChange={(_comment_json, comment_html) => setValue("comment_html", comment_html)}
          onEnterKeyPress={(e) => {
            if (!e?.nativeEvent?.isComposing && !isEmpty && !isSubmitting) {
              handleSubmit(onEnter)(e);
            }
          }}
          showSubmitButton={false}
          uploadFile={
            activityOperations.uploadCommentAsset
              ? async (blockId, file) => {
                  if (!activityOperations.uploadCommentAsset) throw new Error("此会话不支持上传");
                  const { asset_id } = await activityOperations.uploadCommentAsset(blockId, file, comment.id);
                  return asset_id;
                }
              : undefined
          }
          duplicateFile={
            activityOperations.duplicateCommentAsset
              ? async (assetId: string) => {
                  if (!activityOperations.duplicateCommentAsset) throw new Error("此会话不支持上传");
                  const { asset_id } = await activityOperations.duplicateCommentAsset(assetId, comment.id);
                  return asset_id;
                }
              : undefined
          }
          projectId={projectId}
          parentClassName="p-2 bg-surface-1"
          displayConfig={{
            fontSize: "small-font",
          }}
        />
      </div>
      <div className="flex gap-2 self-end">
        {!isEmpty && (
          <button
            type="button"
            onClick={handleSubmit(onEnter)}
            disabled={isDisabled}
            className={cn(
              "group grid size-7 place-items-center rounded-lg border border-success-subtle bg-success-subtle shadow-raised-100 duration-300",
              isDisabled ? "" : "hover:bg-success-subtle-1"
            )}
          >
            <CheckIcon className="size-4 text-success-primary" />
          </button>
        )}
        <button
          type="button"
          disabled={isSubmitting}
          className={cn(
            "group grid size-7 place-items-center rounded-lg border border-danger-subtle bg-danger-subtle shadow-raised-100 duration-300",
            isSubmitting ? "" : "hover:bg-danger-subtle-hover"
          )}
          onClick={() => {
            setIsEditing(false);
            editorRef.current?.setEditorValue(comment.comment_html ?? "<p></p>");
          }}
        >
          <CloseIcon className="size-4 text-danger-primary" />
        </button>
      </div>
    </form>
  );
});
