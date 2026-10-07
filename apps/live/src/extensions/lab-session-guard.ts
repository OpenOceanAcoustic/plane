/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Extension, onConfigurePayload, beforeHandleMessagePayload } from "@hocuspocus/server";
import { Redis } from "@/extensions/redis";
import { handleAuthentication } from "@/lib/auth";
import { AdminCommand, CloseCode } from "@/types/admin-commands";
import type { RevokeUserCommandData } from "@/types/admin-commands";
import type { HocusPocusServerContext } from "@/types";

/** Recovery also revokes already connected editors, including passive document subscribers. */
export class LabSessionGuard implements Extension {
  name = "LabSessionGuard";

  async onConfigure({ instance }: onConfigurePayload) {
    const redis = instance.configuration.extensions.find((extension) => extension instanceof Redis);
    redis?.onAdminCommand<RevokeUserCommandData>(AdminCommand.REVOKE_USER, (data) => {
      if (data.command !== AdminCommand.REVOKE_USER || typeof data.userId !== "string") return;
      for (const document of instance.documents.values()) {
        for (const { connection } of document.connections.values()) {
          if ((connection.context as HocusPocusServerContext).userId === data.userId) {
            connection.close({ code: CloseCode.SECURITY_VIOLATION, reason: "Account credentials revoked" });
          }
        }
      }
    });
  }

  async beforeHandleMessage({ context, connection }: beforeHandleMessagePayload) {
    const session = context as HocusPocusServerContext;
    try {
      // Check the current persisted session/credential generation before every mutation.
      await handleAuthentication({ cookie: session.cookie, userId: session.userId });
    } catch {
      connection.close({ code: CloseCode.SECURITY_VIOLATION, reason: "Session is no longer valid" });
      throw new Error("Session is no longer valid");
    }
  }
}
