/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { API_BASE_URL } from "@plane/constants";
import { LabAuth } from "@plane/ui";
import { PoweredBy } from "@/components/common/powered-by";
// local imports
import { AuthHeader } from "./header";

export function AuthView() {
  return (
    <div className="relative z-10 flex h-screen w-screen flex-col items-center overflow-hidden overflow-y-auto bg-surface-1 px-8 pt-6 pb-10">
      <AuthHeader />
      <LabAuth apiBase={API_BASE_URL} onSuccess={() => window.location.reload()} />
      <PoweredBy />
    </div>
  );
}
