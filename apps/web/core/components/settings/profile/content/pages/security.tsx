/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { API_BASE_URL } from "@plane/constants";
import { LabSecurityService } from "@plane/services";
import { LabBrowserSettings } from "@plane/ui";
const service = new LabSecurityService(API_BASE_URL);
export function SecurityProfileSettings() {
  return (
    <div className="p-6">
      <LabBrowserSettings service={service} onSessionRevoked={() => window.location.assign("/")} />
    </div>
  );
}
