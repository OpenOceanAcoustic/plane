/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { API_BASE_URL } from "@plane/constants";
import { getFileURL } from "@plane/utils";
import { APIService } from "./api.service";

export class ChatImageService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private path(workspaceSlug: string, threadId: string, assetId?: string) {
    return `/api/workspaces/${workspaceSlug}/lab/chat/threads/${threadId}/images/${assetId ? `${assetId}/` : ""}`;
  }

  source(workspaceSlug: string, threadId: string, assetId: string, download = false) {
    return getFileURL(this.path(workspaceSlug, threadId, assetId) + (download ? "?download=1" : "")) ?? "";
  }

  async upload(workspaceSlug: string, threadId: string, file: File): Promise<{ asset_id: string }> {
    const data = new FormData();
    data.append("file", file);
    const response = await this.post(this.path(workspaceSlug, threadId), data);
    return response.data;
  }

  async duplicate(workspaceSlug: string, threadId: string, assetId: string): Promise<{ asset_id: string }> {
    const response = await this.post(`${this.path(workspaceSlug, threadId, assetId)}duplicate/`);
    return response.data;
  }
}
