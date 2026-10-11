/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect } from "react";
import { API_BASE_URL } from "@plane/constants";
import { LabAuth } from "@plane/ui";

export function LabLogin({ register = false, invitationToken = "" }: { register?: boolean; invitationToken?: string }) {
  useEffect(() => {
    if (register) return;
    let disposed = false;
    void fetch(`${API_BASE_URL}/api/users/me/workspaces/`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return false;
        const rows = (await response.json()) as { slug: string }[];
        if (!disposed && rows[0]?.slug) window.location.replace(`/${rows[0].slug}`);
        return true;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [register]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-1 p-6">
      <LabAuth
        apiBase={API_BASE_URL}
        register={register}
        invitationToken={invitationToken}
        onSuccess={() => window.location.replace("/")}
      />
    </div>
  );
}
