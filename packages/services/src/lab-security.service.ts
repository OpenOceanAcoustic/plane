/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { APIService } from "./api.service";

export type TrustedBrowserInfo = {
  id: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  current: boolean;
};
export class LabSecurityService extends APIService {
  private prefix: string;
  constructor(baseURL: string, admin = false) {
    super(baseURL);
    this.prefix = `/auth/lab/${admin ? "admin/" : ""}`;
  }
  async getBrowsers(): Promise<TrustedBrowserInfo[]> {
    const response = await this.get(`${this.prefix}browsers/`);
    return (response.data as { browsers: TrustedBrowserInfo[] }).browsers;
  }
  async revokeBrowser(id: string): Promise<void> {
    await this.delete(`${this.prefix}browsers/${id}/`);
  }
  async forgetBrowser(): Promise<void> {
    await this.post(`${this.prefix}forget-browser/`);
  }
  async reauthenticate(code: string): Promise<void> {
    await this.post("/auth/lab/admin/reauthenticate/", { code });
  }
}
