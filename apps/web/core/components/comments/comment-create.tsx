/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useForm, Controller } from "react-hook-form";
// plane imports
import { EIssueCommentAccessSpecifier } from "@plane/constants";
import type { EditorRefApi } from "@plane/editor";
import type { TComment, TCommentOperations } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import { FileService } from "@/services/file.service";
import { useCommentContext } from "./context";

type TCommentCreate = {
  entityId: string;
  workspaceSlug: string;
  activityOperations: TCommentOperations;
  showToolbarInitially?: boolean;
  projectId?: string;
  onSubmitCallback?: (elementId: string) => void;
};

// services
const fileService = new FileService();

export const CommentCreate = observer(function CommentCreate(props: TCommentCreate) {
  const {
    workspaceSlug,
    entityId,
    activityOperations,
    showToolbarInitially = false,
    projectId,
    onSubmitCallback,
  } = props;
  // states
  const [uploadedAssetIds, setUploadedAssetIds] = useState<string[]>([]);
  const [errorMessage, setError] = useState("");
  const context = useCommentContext();
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  // store hooks
  const workspaceStore = useWorkspace();
  // derived values
  const workspaceId = workspaceStore.getWorkspaceBySlug(workspaceSlug)?.id as string;
  // form info
  const {
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting },
    reset,
  } = useForm<Partial<TComment>>({
    defaultValues: {
      comment_html: context.draft ?? "<p></p>",
    },
  });

  const onSubmit = async (formData: Partial<TComment>) => {
    try {
      setError("");
      const comment = await activityOperations.createComment(formData);
      if (!comment?.id) throw new Error("消息发送失败，请重试");
      if (comment?.id) onSubmitCallback?.(comment.id);
      if (uploadedAssetIds.length > 0) {
        if (projectId) {
          await fileService.updateBulkProjectAssetsUploadStatus(workspaceSlug, projectId.toString(), entityId, {
            asset_ids: uploadedAssetIds,
          });
        } else {
          await fileService.updateBulkWorkspaceAssetsUploadStatus(workspaceSlug, entityId, {
            asset_ids: uploadedAssetIds,
          });
        }
        setUploadedAssetIds([]);
      }
      reset({
        comment_html: "<p></p>",
      });
      editorRef.current?.clearEditor();
      context.onDraftChange?.("<p></p>");
    } catch (error) {
      setError(error instanceof Error ? error.message : "消息发送失败，请重试");
    }
  };

  const commentHTML = watch("comment_html");
  const isEmpty = isCommentEmpty(commentHTML ?? undefined);

  return (
    <div
      className={cn("sticky bottom-0 z-[4] bg-surface-1 sm:static")}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          !e.defaultPrevented &&
          !e?.nativeEvent?.isComposing &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !isEmpty &&
          !isSubmitting &&
          editorRef.current?.isEditorReadyToDiscard()
        )
          handleSubmit(onSubmit)(e);
      }}
    >
      {errorMessage && (
        <p role="alert" className="mb-2 text-13 text-danger-primary">
          {errorMessage}
        </p>
      )}
      <Controller
        name="access"
        control={control}
        render={({ field: { onChange: onAccessChange, value: accessValue } }) => (
          <Controller
            name="comment_html"
            control={control}
            render={({ field: { value, onChange } }) => (
              <LiteTextEditor
                editable
                workspaceId={workspaceId}
                id={"add_comment_" + entityId}
                value={null}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                onEnterKeyPress={(e) => {
                  if (!e?.nativeEvent?.isComposing && !isEmpty && !isSubmitting) {
                    handleSubmit(onSubmit)(e);
                  }
                }}
                ref={editorRef}
                initialValue={value ?? "<p></p>"}
                containerClassName="min-h-min"
                onChange={(_comment_json, comment_html) => {
                  onChange(comment_html);
                  context.onDraftChange?.(comment_html);
                }}
                accessSpecifier={accessValue ?? EIssueCommentAccessSpecifier.INTERNAL}
                handleAccessChange={onAccessChange}
                isSubmitting={isSubmitting}
                uploadFile={
                  activityOperations.uploadCommentAsset
                    ? async (blockId, file) => {
                        if (!activityOperations.uploadCommentAsset) throw new Error("此会话不支持上传");
                        const { asset_id } = await activityOperations.uploadCommentAsset(blockId, file);
                        setUploadedAssetIds((prev) => [...prev, asset_id]);
                        return asset_id;
                      }
                    : undefined
                }
                duplicateFile={
                  activityOperations.duplicateCommentAsset
                    ? async (assetId: string) => {
                        if (!activityOperations.duplicateCommentAsset) throw new Error("此会话不支持上传");
                        const { asset_id } = await activityOperations.duplicateCommentAsset(assetId);
                        setUploadedAssetIds((prev) => [...prev, asset_id]);
                        return asset_id;
                      }
                    : undefined
                }
                submitButtonText={context.submitLabel}
                showToolbarInitially={showToolbarInitially}
                parentClassName="p-2"
                displayConfig={{
                  fontSize: "small-font",
                }}
              />
            )}
          />
        )}
      />
    </div>
  );
});
