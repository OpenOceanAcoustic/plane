/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeMobileTicket } from "@/lib/mobile-auth";
import { onAuthenticate } from "@/lib/auth";
import { redisManager } from "@/redis";
import { UserService } from "@/services/user.service";
import type { HocusPocusServerContext } from "@/types";
import { Hocuspocus } from "@hocuspocus/server";
import { WebSocket } from "ws";

vi.mock("@/redis", () => ({ redisManager: { getClient: vi.fn() } }));
vi.mock("@/services/user.service", () => ({ UserService: vi.fn() }));
vi.mock("@plane/logger", () => ({ logger: { error: vi.fn() } }));

const ticket = "a".repeat(43);
const payload = {
  user_id: "mobile-user",
  page_id: "page",
  project_id: "project",
  workspace_slug: "lab",
  document_type: "project_page",
  cookie: "session-id=protected",
  read_only: false,
};
const parameters = new URLSearchParams({ workspaceSlug: "lab", projectId: "project", documentType: "project_page" });

beforeEach(() => vi.resetAllMocks());

describe("single-use mobile collaboration authentication", () => {
  it("atomically consumes a document-bound ticket exactly once", async () => {
    const getdel = vi.fn().mockResolvedValueOnce(JSON.stringify(payload)).mockResolvedValueOnce(null);
    vi.mocked(redisManager.getClient).mockReturnValue({ getdel } as never);
    const result = await consumeMobileTicket(ticket, "page", parameters);
    expect(result).toEqual(payload);
    expect(getdel).toHaveBeenCalledWith(
      "hocuspocus:mobile-ticket:" + createHash("sha256").update(ticket).digest("hex")
    );
    await expect(consumeMobileTicket(ticket, "page", parameters)).rejects.toThrow("Ticket is invalid or expired");
  });

  it("rejects expired and wrong-document tickets", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({ getdel: vi.fn().mockResolvedValue(null) } as never);
    await expect(consumeMobileTicket(ticket, "page", parameters)).rejects.toThrow("Ticket is invalid or expired");
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    } as never);
    await expect(consumeMobileTicket(ticket, "another-page", parameters)).rejects.toThrow(
      "Ticket document does not match"
    );
    await expect(
      consumeMobileTicket(
        ticket,
        "page",
        new URLSearchParams({ workspaceSlug: "other", projectId: "project", documentType: "project_page" })
      )
    ).rejects.toThrow("Ticket document does not match");
  });

  it("keeps the session cookie server-side and applies read-only permissions", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockResolvedValue(JSON.stringify({ ...payload, read_only: true })),
    } as never);
    const currentUser = vi.fn().mockResolvedValue({ id: "mobile-user", display_name: "Mobile" });
    vi.mocked(UserService).mockImplementation(function () {
      return { currentUser } as never;
    });
    const context = {} as HocusPocusServerContext;
    const connection = { readOnly: false };
    const result = await onAuthenticate({
      requestHeaders: {},
      requestParameters: parameters,
      context,
      token: JSON.stringify({ ticket }),
      documentName: "page",
      connection,
    });
    expect(result.user.id).toBe("mobile-user");
    expect(context.cookie).toBe("session-id=protected");
    expect(currentUser).toHaveBeenCalledWith("session-id=protected");
    expect(connection.readOnly).toBe(true);
  });

  it("rejects revoked sessions even with a previously issued ticket", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    } as never);
    vi.mocked(UserService).mockImplementation(function () {
      return { currentUser: vi.fn().mockRejectedValue(new Error("revoked")) } as never;
    });
    await expect(
      onAuthenticate({
        requestHeaders: {},
        requestParameters: parameters,
        context: {} as HocusPocusServerContext,
        token: JSON.stringify({ ticket }),
        documentName: "page",
        connection: { readOnly: false },
      })
    ).rejects.toThrow("Authentication unsuccessful");
  });

  it("retains browser authentication with cookie and user id", async () => {
    vi.mocked(UserService).mockImplementation(function () {
      return { currentUser: vi.fn().mockResolvedValue({ id: "web", display_name: "Web" }) } as never;
    });
    const context = {} as HocusPocusServerContext;
    const result = await onAuthenticate({
      requestHeaders: { cookie: "session-id=browser" },
      requestParameters: parameters,
      context,
      token: JSON.stringify({ id: "web" }),
      documentName: "page",
      connection: { readOnly: false },
    });
    expect(result.user.id).toBe("web");
    expect(context.cookie).toBe("session-id=browser");
    expect(redisManager.getClient).not.toHaveBeenCalled();
  });

  it("carries authenticated ticket context through real Hocuspocus hooks to document loading", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return JSON.stringify(payload);
      }),
    } as never);
    vi.mocked(UserService).mockImplementation(function () {
      return {
        currentUser: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { id: "mobile-user", display_name: "Mobile" };
        },
      } as never;
    });
    let resolveLoaded!: (context: HocusPocusServerContext) => void;
    const loaded = new Promise<HocusPocusServerContext>((resolve) => {
      resolveLoaded = resolve;
    });
    const server = new Hocuspocus({
      address: "127.0.0.1",
      port: 0,
      quiet: true,
      stopOnSignals: false,
      onConnect: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { connected: true };
      },
      onAuthenticate,
      onLoadDocument: async ({ context }) => {
        resolveLoaded(context as HocusPocusServerContext);
      },
    });
    await server.listen();
    const socket = new WebSocket(`${server.webSocketURL}/?${parameters}`);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const name = Buffer.from("page");
      const token = Buffer.from(JSON.stringify({ ticket }));
      // Hocuspocus protocol: document string, Auth message (2), Token subtype (0), token string.
      socket.send(Buffer.concat([Buffer.from([name.length]), name, Buffer.from([2, 0, token.length]), token]));
      const context = await loaded;
      expect(context).toMatchObject({
        cookie: payload.cookie,
        userId: payload.user_id,
        workspaceSlug: payload.workspace_slug,
        projectId: payload.project_id,
        documentType: payload.document_type,
        user: { id: "mobile-user", name: "Mobile" },
      });
    } finally {
      socket.terminate();
      await server.destroy();
    }
  });
});
