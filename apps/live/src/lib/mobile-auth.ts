/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { redisManager } from "@/redis";

const ticketPayload = z.object({
  user_id: z.string().min(1),
  page_id: z.string().min(1),
  project_id: z.string().min(1),
  workspace_slug: z.string().min(1),
  document_type: z.literal("project_page"),
  cookie: z.string().min(1),
  read_only: z.boolean(),
});

/** Atomic GETDEL prevents a token from admitting two websocket connections. */
export const consumeMobileTicket = async (ticket: string, documentName: string, parameters: URLSearchParams) => {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(ticket)) {
    throw new AppError("Ticket is invalid or expired", { code: "AUTH_INVALID_TICKET" });
  }
  const redis = redisManager.getClient();
  if (!redis) throw new AppError("Collaboration service unavailable", { code: "AUTH_TICKET_UNAVAILABLE" });
  const key = "hocuspocus:mobile-ticket:" + createHash("sha256").update(ticket).digest("hex");
  const stored = await redis.getdel(key);
  if (!stored) throw new AppError("Ticket is invalid or expired", { code: "AUTH_INVALID_TICKET" });
  const result = ticketPayload.parse(JSON.parse(stored));
  if (
    result.page_id !== documentName ||
    result.project_id !== parameters.get("projectId") ||
    result.workspace_slug !== parameters.get("workspaceSlug") ||
    result.document_type !== parameters.get("documentType")
  ) {
    throw new AppError("Ticket document does not match", { code: "AUTH_TICKET_MISMATCH" });
  }
  return result;
};
