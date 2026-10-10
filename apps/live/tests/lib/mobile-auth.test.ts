/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { onAuthenticatePayload } from "@hocuspocus/server";
import { consumeMobileTicket } from "@/lib/mobile-auth";
import { onAuthenticate } from "@/lib/auth";
import { redisManager } from "@/redis";
import { CollaborationService } from "@/services/collaboration.service";
import type { CollaborationAccess } from "@/services/collaboration.service";
import type { HocusPocusServerContext } from "@/types";
import { Hocuspocus } from "@hocuspocus/server";
import { WebSocket } from "ws";

vi.mock("@/redis", () => ({ redisManager: { getClient: vi.fn() } }));
vi.mock("@/services/collaboration.service", () => ({ CollaborationService: vi.fn() }));
vi.mock("@/env", () => ({ env: { PUBLIC_ORIGIN: "https://plane.example.org" } }));
vi.mock("@plane/logger", () => ({ logger: { error: vi.fn() } }));

const ticket = "a".repeat(43);
const pageId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const payload = {
  user_id: "mobile-user",
  page_id: pageId,
  project_id: projectId,
  workspace_slug: "lab",
  document_type: "project_page",
  cookie: "session-id=protected",
  read_only: false,
};
const parameters = new URLSearchParams({ workspaceSlug: "lab", projectId, documentType: "project_page" });
const access: CollaborationAccess = {
  document: {
    id: pageId,
    type: "project_page",
    workspace_id: "workspace",
    workspace_slug: "lab",
    project_id: projectId,
  },
  user: { id: "mobile-user", display_name: "Mobile" },
  can_read: true,
  can_write: true,
  session_expires_at: new Date(Date.now() + 60000).toISOString(),
  credential_generation: "credential-generation",
};
const acl = vi.fn();
const authenticate = (
  input: Pick<onAuthenticatePayload, "context" | "token" | "connection"> & Partial<onAuthenticatePayload>
) =>
  onAuthenticate({
    requestHeaders: { origin: "https://localhost" },
    requestParameters: parameters,
    documentName: pageId,
    instance: new Hocuspocus({ quiet: true, stopOnSignals: false }),
    socketId: "fixture-socket",
    request: {} as IncomingMessage,
    ...input,
  });

beforeEach(() => {
  vi.resetAllMocks();
  acl.mockResolvedValue(access);
  vi.mocked(CollaborationService).mockImplementation(function () {
    return { access: acl } as never;
  });
});

describe("single-use mobile collaboration authentication", () => {
  it("atomically consumes a document-bound ticket exactly once", async () => {
    const getdel = vi.fn().mockResolvedValueOnce(JSON.stringify(payload)).mockResolvedValueOnce(null);
    vi.mocked(redisManager.getClient).mockReturnValue({ getdel } as never);
    const result = await consumeMobileTicket(ticket, pageId, parameters);
    expect(result).toEqual(payload);
    expect(getdel).toHaveBeenCalledWith(
      "hocuspocus:mobile-ticket:" + createHash("sha256").update(ticket).digest("hex")
    );
    await expect(consumeMobileTicket(ticket, pageId, parameters)).rejects.toThrow("Ticket is invalid or expired");
  });

  it("rejects expired and wrong-document tickets", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({ getdel: vi.fn().mockResolvedValue(null) } as never);
    await expect(consumeMobileTicket(ticket, pageId, parameters)).rejects.toThrow("Ticket is invalid or expired");
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    } as never);
    await expect(consumeMobileTicket(ticket, "another-page", parameters)).rejects.toThrow(
      "Ticket document does not match"
    );
    await expect(
      consumeMobileTicket(
        ticket,
        pageId,
        new URLSearchParams({ workspaceSlug: "other", projectId, documentType: "project_page" })
      )
    ).rejects.toThrow("Ticket document does not match");
  });

  it("keeps the session cookie server-side and applies read-only permissions", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockResolvedValue(JSON.stringify({ ...payload, read_only: true })),
    } as never);
    const context = {} as HocusPocusServerContext;
    const connection = { readOnly: false, requiresAuthentication: true, isAuthenticated: false };
    const result = await authenticate({
      requestParameters: parameters,
      context,
      token: JSON.stringify({ ticket }),
      connection,
    });
    expect(result.user.id).toBe("mobile-user");
    expect(context.cookie).toBe("session-id=protected");
    expect(acl).toHaveBeenCalledWith("session-id=protected", "lab", projectId, pageId);
    expect(result.expiresAt).toBe(Date.parse(access.session_expires_at));
    expect(result.credentialGeneration).toBe(access.credential_generation);
    expect(connection.readOnly).toBe(true);
  });

  it("rejects revoked sessions even with a previously issued ticket", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    } as never);
    acl.mockRejectedValueOnce(new Error("revoked"));
    await expect(
      authenticate({
        requestParameters: parameters,
        context: {} as HocusPocusServerContext,
        token: JSON.stringify({ ticket }),
        connection: { readOnly: false, requiresAuthentication: true, isAuthenticated: false },
      })
    ).rejects.toThrow("revoked");
  });

  it("retains browser authentication with cookie and user id", async () => {
    acl.mockResolvedValueOnce({ ...access, user: { id: "web", display_name: "Web" } });
    const context = {} as HocusPocusServerContext;
    const result = await authenticate({
      requestHeaders: { cookie: "session-id=browser", origin: "https://plane.example.org" },
      requestParameters: parameters,
      context,
      token: JSON.stringify({ id: "web" }),
      connection: { readOnly: false, requiresAuthentication: true, isAuthenticated: false },
    });
    expect(result.user.id).toBe("web");
    expect(context.cookie).toBe("session-id=browser");
    expect(redisManager.getClient).not.toHaveBeenCalled();
  });

  it("requires a ticket for native Origin and denies other browser origins before consuming tickets", async () => {
    await expect(
      authenticate({
        context: {} as HocusPocusServerContext,
        token: JSON.stringify({ id: "mobile-user", cookie: payload.cookie }),
        connection: { readOnly: false, requiresAuthentication: true, isAuthenticated: false },
      })
    ).rejects.toThrow("Mobile collaboration ticket required");
    await expect(
      authenticate({
        requestHeaders: { origin: "https://evil.example.org" },
        context: {} as HocusPocusServerContext,
        token: JSON.stringify({ ticket }),
        connection: { readOnly: false, requiresAuthentication: true, isAuthenticated: false },
      })
    ).rejects.toThrow("Origin denied");
    expect(redisManager.getClient).not.toHaveBeenCalled();
    expect(acl).not.toHaveBeenCalled();
  });

  it("checks current ACL and session expiry even when the ticket previously allowed writes", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    } as never);
    acl.mockResolvedValueOnce({ ...access, can_write: false });
    const connection = { readOnly: false, requiresAuthentication: true, isAuthenticated: false };
    await authenticate({ context: {} as HocusPocusServerContext, token: JSON.stringify({ ticket }), connection });
    expect(connection.readOnly).toBe(true);
    acl.mockResolvedValueOnce({ ...access, session_expires_at: new Date(Date.now() - 1000).toISOString() });
    await expect(
      authenticate({
        context: {} as HocusPocusServerContext,
        token: JSON.stringify({ ticket }),
        connection: { readOnly: false, requiresAuthentication: true, isAuthenticated: false },
      })
    ).rejects.toThrow("Document access denied");
  });

  it("carries authenticated ticket context through real Hocuspocus hooks to document loading", async () => {
    vi.mocked(redisManager.getClient).mockReturnValue({
      getdel: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return JSON.stringify(payload);
      }),
    } as never);
    acl.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return access;
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
    const socket = new WebSocket(`${server.webSocketURL}/?${parameters}`, { headers: { Origin: "https://localhost" } });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const name = Buffer.from(pageId);
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
