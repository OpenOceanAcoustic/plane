/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { API_BASE_URL, ADMIN_BASE_PATH } from "@plane/constants";
import { LabSecurityService } from "@plane/services";
import { LabBrowserSettings } from "@plane/ui";
const service = new LabSecurityService(API_BASE_URL, true);
export default function InstanceAuthenticationPage() {
  return (
    <section className="max-w-2xl p-6">
      <LabBrowserSettings service={service} onSessionRevoked={() => window.location.assign(ADMIN_BASE_PATH || "/")} />
    </section>
  );
}
