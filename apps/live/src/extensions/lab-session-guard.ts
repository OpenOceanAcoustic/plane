/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type {
  Extension,
  onConfigurePayload,
  beforeHandleMessagePayload,
  connectedPayload,
  onDisconnectPayload,
  Connection,
} from "@hocuspocus/server";
import { Redis } from "@/extensions/redis";
import { authorizeDocument } from "@/lib/auth";
import { collaborationLimits } from "@/lib/collaboration-limits";
import { AdminCommand, CloseCode } from "@/types/admin-commands";
import type { RevokeUserCommandData, InvalidateAccessCommandData } from "@/types/admin-commands";
import type { HocusPocusServerContext } from "@/types";

/** Both active editors and passive subscribers lose revoked access. */
export class LabSessionGuard implements Extension {
  name = "LabSessionGuard";
  private timers = new Map<
    string,
    { expiry: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> }
  >();
  private pending = new WeakMap<HocusPocusServerContext, Promise<void>>();

  async onConfigure({ instance }: onConfigurePayload) {
    const redis = instance.configuration.extensions.find((extension) => extension instanceof Redis);
    redis?.onAdminCommand<RevokeUserCommandData>(AdminCommand.REVOKE_USER, (data) => {
      if (data.command !== AdminCommand.REVOKE_USER || typeof data.userId !== "string") return;
      for (const document of instance.documents.values())
        for (const { connection } of document.connections.values()) {
          if ((connection.context as HocusPocusServerContext).userId === data.userId) this.close(connection);
        }
    });
    redis?.onAdminCommand<InvalidateAccessCommandData>(AdminCommand.INVALIDATE_ACCESS, (data) => {
      if (
        ![data.userId, data.pageId, data.projectId, data.workspaceId].some(
          (value) => typeof value === "string" && value.length > 0
        )
      )
        return;
      for (const document of instance.documents.values())
        for (const { connection } of document.connections.values()) {
          const session = connection.context as HocusPocusServerContext;
          if (
            (!data.userId || data.userId === session.userId) &&
            (!data.pageId || data.pageId === document.name) &&
            (!data.projectId || data.projectId === session.projectId) &&
            (!data.workspaceId || data.workspaceId === session.access?.document.workspace_id)
          )
            this.close(connection);
        }
    });
  }

  private close(connection: Connection) {
    connection.close({ code: CloseCode.SECURITY_VIOLATION, reason: "Session or document access is no longer valid" });
  }

  private async check(session: HocusPocusServerContext, connection: Connection, documentName: string, fresh = false) {
    if (!session.expiresAt || Date.now() >= session.expiresAt) throw new Error("Session expired");
    if (!fresh && Date.now() - (session.accessCheckedAt ?? 0) < 2000) return;
    let pending = this.pending.get(session);
    if (!pending) {
      pending = authorizeDocument(session, documentName)
        .then((access) => {
          session.access = access;
          session.accessCheckedAt = Date.now();
          connection.readOnly = !access.can_write;
          return;
        })
        .finally(() => this.pending.delete(session));
      this.pending.set(session, pending);
    }
    await pending;
  }

  async connected({ context, connectionInstance, documentName, socketId, instance }: connectedPayload) {
    const session = context as HocusPocusServerContext;
    session.transport?.ready(documentName);
    collaborationLimits(instance).established(`${socketId}:${documentName}`);
    const expiry = setTimeout(() => this.close(connectionInstance), Math.max(0, (session.expiresAt ?? 0) - Date.now()));
    const interval = setInterval(() => {
      void this.check(session, connectionInstance, documentName, true).catch(() => this.close(connectionInstance));
    }, 15000);
    expiry.unref();
    interval.unref();
    this.timers.set(`${socketId}:${documentName}`, { expiry, interval });
  }

  async onDisconnect({ context, socketId, documentName, instance }: onDisconnectPayload) {
    (context as HocusPocusServerContext).transport?.remove(documentName);
    const key = `${socketId}:${documentName}`;
    const timers = this.timers.get(key);
    if (timers) {
      clearTimeout(timers.expiry);
      clearInterval(timers.interval);
      this.timers.delete(key);
    }
    collaborationLimits(instance).release((context as HocusPocusServerContext).userId, key);
  }
  async onDestroy() {
    for (const { expiry, interval } of this.timers.values()) {
      clearTimeout(expiry);
      clearInterval(interval);
    }
    this.timers.clear();
  }
  async beforeHandleMessage({ context, connection, documentName, instance, update }: beforeHandleMessagePayload) {
    const session = context as HocusPocusServerContext;
    try {
      collaborationLimits(instance).message(session.userId, update.byteLength);
      await this.check(session, connection, documentName);
    } catch {
      this.close(connection);
      throw new Error("Session or document access is no longer valid");
    }
  }
}
