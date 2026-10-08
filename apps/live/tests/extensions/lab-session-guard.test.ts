/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it, vi } from "vitest";
import type { beforeHandleMessagePayload, onConfigurePayload } from "@hocuspocus/server";
import { LabSessionGuard } from "@/extensions/lab-session-guard";
import { Redis } from "@/extensions/redis";
import { handleAuthentication } from "@/lib/auth";
import { AdminCommand, CloseCode } from "@/types/admin-commands";
import type { RevokeUserCommandData } from "@/types/admin-commands";

vi.mock("@/extensions/redis", () => ({
  Redis: class {
    onAdminCommand = vi.fn();
  },
}));
vi.mock("@/lib/auth", () => ({ handleAuthentication: vi.fn() }));

describe("laboratory live credential recovery", () => {
  it("disconnects established subscriptions only for the recovered user", async () => {
    const redis = new Redis();
    const recovered = { context: { userId: "recovered" }, close: vi.fn() };
    const other = { context: { userId: "other" }, close: vi.fn() };
    const instance = {
      configuration: { extensions: [redis] },
      documents: new Map([
        [
          "page",
          {
            connections: new Map([
              ["a", { connection: recovered }],
              ["b", { connection: other }],
            ]),
          },
        ],
      ]),
    };
    await new LabSessionGuard().onConfigure({ instance } as unknown as onConfigurePayload);
    const callback = vi.mocked(redis.onAdminCommand).mock.calls[0]![1] as (data: RevokeUserCommandData) => void;
    callback({
      command: AdminCommand.REVOKE_USER,
      userId: "recovered",
      originServer: "ssh",
      timestamp: new Date().toISOString(),
    });
    expect(recovered.close).toHaveBeenCalledWith({
      code: CloseCode.SECURITY_VIOLATION,
      reason: "Account credentials revoked",
    });
    expect(other.close).not.toHaveBeenCalled();
  });

  it("rejects an established connection's next mutation if its persisted session was revoked", async () => {
    vi.mocked(handleAuthentication).mockRejectedValueOnce(new Error("revoked"));
    const connection = { close: vi.fn() };
    const context = { userId: "recovered", cookie: "old-session" };
    await expect(
      new LabSessionGuard().beforeHandleMessage({ context, connection } as unknown as beforeHandleMessagePayload)
    ).rejects.toThrow("Session is no longer valid");
    expect(handleAuthentication).toHaveBeenCalledWith({ userId: "recovered", cookie: "old-session" });
    expect(connection.close).toHaveBeenCalled();
  });
});
