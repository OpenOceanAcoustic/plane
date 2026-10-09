/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { APIService } from "./api.service";

export type CollaborationAccess = {
  document: { id: string; type: "project_page"; workspace_id: string; workspace_slug: string; project_id: string };
  user: { id: string; display_name: string };
  can_read: boolean;
  can_write: boolean;
  session_expires_at: string;
  credential_generation: string | null;
};

export class CollaborationService extends APIService {
  async access(cookie: string, workspaceSlug: string, projectId: string, pageId: string): Promise<CollaborationAccess> {
    const response = await this.get(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${projectId}/pages/${pageId}/collaboration-access/`,
      { headers: { Cookie: cookie }, timeout: 5000 }
    );
    return response.data as CollaborationAccess;
  }
}
