/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type LabDocumentFile = {
  name: string;
  extension: string;
  content_type: string;
  size: number;
  version_id: string;
  previewable: boolean;
  download_path: string;
  preview_path: string | null;
};

export type LabDocumentPreview = { text: string; format: "txt" | "md"; filename: string };

export type LabDocument = {
  id: string;
  name: string;
  project_id: string;
  access: 0 | 1;
  owned_by: string;
  is_locked: boolean;
  archived_at: string | null;
  updated_at: string;
  file: LabDocumentFile | null;
};

export type LabDocumentTask = { id: string; title: string; project_id: string; key: string };
export type LabDocumentList = { documents: LabDocument[]; can_edit: boolean };
export type LabDocumentTaskList = { tasks: LabDocumentTask[]; can_edit: boolean };

export function documentLink(workspaceSlug: string, document: Pick<LabDocument, "id" | "project_id">): string {
  return `/${encodeURIComponent(workspaceSlug)}/projects/${document.project_id}/pages/${document.id}`;
}
