/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type LabDocument = {
  id: string;
  name: string;
  project_id: string;
  access: 0 | 1;
  owned_by: string;
  is_locked: boolean;
  archived_at: string | null;
  updated_at: string;
};

export type LabDocumentTask = { id: string; title: string; project_id: string; key: string };
export type LabDocumentList = { documents: LabDocument[]; can_edit: boolean };
export type LabDocumentTaskList = { tasks: LabDocumentTask[]; can_edit: boolean };

export function documentLink(workspaceSlug: string, document: Pick<LabDocument, "id" | "project_id">): string {
  return `/${encodeURIComponent(workspaceSlug)}/projects/${document.project_id}/pages/${document.id}`;
}
