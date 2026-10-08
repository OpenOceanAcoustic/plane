/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { API_BASE_URL, ADMIN_BASE_PATH } from "@plane/constants";
import { LabAuth } from "@plane/ui";
export default function HomePage() {
  return (
    <div className="flex min-h-[80vh] w-full items-center">
      <LabAuth apiBase={API_BASE_URL} admin onSuccess={() => window.location.assign(`${ADMIN_BASE_PATH}/general`)} />
    </div>
  );
}
