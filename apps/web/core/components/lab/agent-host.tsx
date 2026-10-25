/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from "react";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import { useLocation, useParams } from "react-router";
import { LabAgentChat } from "./agent-chat";

export function LabAgentHost() {
  const { workspaceSlug = "" } = useParams();
  const { pathname } = useLocation();
  const store = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  if (!workspaceSlug || pathname.endsWith("/lab/ai")) return null;
  return <LabAgentChat key={workspaceSlug} store={store} workspaceSlug={workspaceSlug} />;
}
