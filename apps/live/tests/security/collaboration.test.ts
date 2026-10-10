/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { Hocuspocus } from "@hocuspocus/server";
import { WebSocket } from "ws";
import { Doc } from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabSessionGuard } from "@/extensions/lab-session-guard";
import { Redis } from "@/extensions/redis";
import { onAuthenticate } from "@/lib/auth";
import { CollaborationController } from "@/controllers/collaboration.controller";
import type { Request } from "express";

const configuration = vi.hoisted(() => ({ API_BASE_URL: "", PUBLIC_ORIGIN: "https://plane.example.org" }));
vi.mock("@/env", () => ({ env: configuration }));
const commands = vi.hoisted(() => new Map<string, (data: Record<string, string>) => void>());
vi.mock("@/extensions/redis", () => ({
  Redis: class {
    onAdminCommand(name: string, callback: (data: Record<string, string>) => void) {
      commands.set(name, callback);
    }
  },
}));
vi.mock("@plane/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const requireEditor = createRequire(new URL("../../../../packages/editor/package.json", import.meta.url));
const HocuspocusProviderWebsocket = requireEditor("@hocuspocus/provider").HocuspocusProviderWebsocket as new (
  options: Record<string, unknown>
) => { destroy(): void; disconnect(): void; shouldConnect: boolean };
type Provider = { destroy(): void; configuration: { websocketProvider: { destroy(): void } } };
const HocuspocusProvider = requireEditor("@hocuspocus/provider").HocuspocusProvider as new (
  options: Record<string, unknown>
) => Provider;
const pageId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  // oxlint-disable-next-line no-await-in-loop -- LIFO teardown must disconnect providers before destroying their server and authorization API.
  for (const close of cleanup.splice(0).toReversed()) await close();
});

async function fixture() {
  commands.clear();
  const revoked = new Set<string>();
  const calls = new Map<string, number>();
  const closed = new WeakMap<Doc, Promise<number>>();
  const api = createServer((request, response) => {
    const user = request.headers.cookie?.split("=")[1] ?? "owner";
    calls.set(user, (calls.get(user) ?? 0) + 1);
    response.setHeader("Content-Type", "application/json");
    if (request.url?.endsWith("collaboration-access/") && (user === "visitor" || revoked.has(user))) {
      response.writeHead(403).end(JSON.stringify({ error: "Permission denied" }));
      return;
    }
    const result =
      request.url === "/api/users/me/"
        ? { id: user, display_name: user }
        : {
            document: {
              id: pageId,
              type: "project_page",
              project_id: projectId,
              workspace_slug: "lab",
              workspace_id: "workspace",
            },
            user: { id: user, display_name: user },
            can_read: true,
            can_write: user !== "reader",
            session_expires_at: new Date(Date.now() + (user === "expiring" ? 200 : 60000)).toISOString(),
            credential_generation: "test-generation",
          };
    response.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  configuration.API_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  cleanup.push(() => new Promise<void>((resolve) => api.close(() => resolve())));
  const server = new Hocuspocus({
    address: "127.0.0.1",
    port: 0,
    quiet: true,
    stopOnSignals: false,
    debounce: 0,
    onAuthenticate,
    extensions: [new Redis(), new LabSessionGuard()],
    async onLoadDocument({ document }) {
      document.getMap("content").set("secret", "private fixture text");
    },
  });
  const handle = server.handleConnection.bind(server);
  const controller = new CollaborationController({ handleConnection: handle } as Hocuspocus);
  server.handleConnection = (socket, request) => controller.handleConnection(socket, request as Request);
  await server.listen(null, null, { maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  cleanup.push(() => server.destroy());
  const connect = async (user: string, origin = configuration.PUBLIC_ORIGIN) => {
    const document = new Doc();
    cleanup.push(() => document.destroy());
    let close: (code: number) => void;
    closed.set(
      document,
      new Promise<number>((resolve) => {
        close = resolve;
      })
    );
    return new Promise<Doc>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sync timeout")), 3000);
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: `ws://127.0.0.1:${server.address.port}`,
        maxAttempts: 1,
        onDisconnect() {
          websocketProvider.shouldConnect = false;
        },
        WebSocketPolyfill: class extends WebSocket {
          constructor(url: string) {
            super(url, { headers: { Origin: origin, Cookie: `session-id=${user}` } });
          }
        },
        parameters: { documentType: "project_page", workspaceSlug: "lab", projectId },
      });
      const provider = new HocuspocusProvider({
        websocketProvider,
        name: pageId,
        document,
        token: JSON.stringify({ id: user }),
        onClose({ event }: { event: { code: number } }) {
          close(event.code);
        },
        onSynced({ state }: { state: boolean }) {
          if (state) {
            clearTimeout(timeout);
            resolve(document);
          }
        },
        onAuthenticationFailed() {
          websocketProvider.disconnect();
          clearTimeout(timeout);
          reject(new Error("Authentication rejected"));
        },
      });
      cleanup.push(() => {
        clearTimeout(timeout);
        provider.destroy();
        provider.configuration.websocketProvider.destroy();
      });
    });
  };
  return Object.assign(connect, { revoked, closed, calls, server });
}

describe("collaboration access over the real WebSocket protocol", () => {
  it("denies a second user access to an already loaded private document", async () => {
    const connect = await fixture();
    const owner = await connect("owner");
    expect(owner.getMap("content").get("secret")).toBe("private fixture text");
    await expect(connect("visitor")).rejects.toThrow("Authentication rejected");
  });
  it("syncs a reader but rejects their document mutation", async () => {
    const connect = await fixture();
    const owner = await connect("owner");
    const reader = await connect("reader");
    expect(reader.getMap("content").get("secret")).toBe("private fixture text");
    reader.getMap("content").set("injected", true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(owner.getMap("content").has("injected")).toBe(false);
  });
  it("closes a passive subscriber at its persisted expiry", async () => {
    const connect = await fixture();
    const user = await connect("expiring");
    await expect(connect.closed.get(user)).resolves.toBe(4003);
  });
  it("rejects revoked document access after the two-second cache expires", async () => {
    const connect = await fixture();
    const user = await connect("owner");
    connect.revoked.add("owner");
    await new Promise((resolve) => setTimeout(resolve, 2050));
    user.getMap("content").set("post-revocation", true);
    await expect(connect.closed.get(user)).resolves.toBe(4003);
  });
  it("closes a client exceeding the user message budget", async () => {
    const connect = await fixture();
    const user = await connect("owner");
    for (let index = 0; index < 25; index++) user.getMap("content").set("burst", index);
    await expect(connect.closed.get(user)).resolves.toBe(4003);
  });
  it("denies another Origin before accessing the authorization API", async () => {
    const connect = await fixture();
    await expect(connect("owner", "https://evil.plane.example.org")).rejects.toThrow("Authentication rejected");
    expect(connect.calls.get("owner")).toBeUndefined();
  });
  it("denies a ninth concurrent document connection before an API call", async () => {
    const connect = await fixture();
    for (let index = 0; index < 8; index++) {
      // oxlint-disable-next-line no-await-in-loop -- Establish each connection before adding another to exercise the concurrent document cap.
      await connect("owner");
      // oxlint-disable-next-line no-await-in-loop -- Spread provider handshakes across message-budget windows so this test isolates the document cap.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const calls = connect.calls.get("owner");
    await expect(connect("owner")).rejects.toThrow("Authentication rejected");
    expect(connect.calls.get("owner")).toBe(calls);
  });
  it("disconnects the scoped document subscriber immediately on Redis invalidation", async () => {
    const connect = await fixture();
    const owner = await connect("owner");
    const reader = await connect("reader");
    commands.get("invalidate_access")?.({ command: "invalidate_access", userId: "owner", pageId, projectId });
    await expect(connect.closed.get(owner)).resolves.toBe(4003);
    expect(reader.getMap("content").get("secret")).toBe("private fixture text");
    expect(connect.server.documents.get(pageId)?.getConnectionsCount()).toBe(1);
  });
  it("rechecks silent subscriptions when a Redis invalidation was missed", async () => {
    const connect = await fixture();
    const owner = await connect("owner");
    connect.revoked.add("owner");
    await expect(connect.closed.get(owner)).resolves.toBe(4003);
  }, 20000);
  it("rejects an oversized binary frame before document decoding", async () => {
    const connect = await fixture();
    const owner = await connect("owner");
    owner.getMap("content").set("oversized", "x".repeat(8 * 1024 * 1024 + 1));
    await expect(connect.closed.get(owner)).resolves.toBe(1009);
  });
  it("rejects a frame flood before authentication can populate Hocuspocus queues", async () => {
    const connect = await fixture();
    const socket = new WebSocket(`ws://127.0.0.1:${connect.server.address.port}`, {
      headers: { Origin: configuration.PUBLIC_ORIGIN },
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    cleanup.push(() => socket.close());
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    const frame = Buffer.concat([Buffer.from([pageId.length]), Buffer.from(pageId), Buffer.from([0, 0, 0])]);
    for (let index = 0; index < 21; index++) socket.send(frame);
    expect(await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(0), 1000))])).toBe(4003);
    expect(connect.calls.size).toBe(0);
  });
  it("bounds accumulated frames while document authentication is pending", async () => {
    const connect = await fixture();
    const socket = new WebSocket(`ws://127.0.0.1:${connect.server.address.port}`, {
      headers: { Origin: configuration.PUBLIC_ORIGIN },
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    cleanup.push(() => socket.close());
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    const frame = Buffer.concat([
      Buffer.from([pageId.length]),
      Buffer.from(pageId),
      Buffer.from([0, 0, 0]),
      Buffer.alloc(4 * 1024 * 1024),
    ]);
    socket.send(frame);
    socket.send(frame);
    expect(await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(0), 1000))])).toBe(4003);
    expect(connect.calls.size).toBe(0);
  });
  it("bounds the retained authentication queues across all sockets", async () => {
    const connect = await fixture();
    const frame = Buffer.concat([
      Buffer.from([pageId.length]),
      Buffer.from(pageId),
      Buffer.from([0, 0, 0]),
      Buffer.alloc(7.5 * 1024 * 1024),
    ]);
    const closed: Array<Promise<number>> = [];
    for (let index = 0; index < 9; index++) {
      const socket = new WebSocket(`ws://127.0.0.1:${connect.server.address.port}`, {
        headers: { Origin: configuration.PUBLIC_ORIGIN },
      });
      // oxlint-disable-next-line no-await-in-loop -- Admit each socket and retain its frames before testing the next socket against the aggregate queue bound.
      await new Promise<void>((resolve) => socket.once("open", resolve));
      cleanup.push(() => socket.close());
      closed.push(new Promise<number>((resolve) => socket.once("close", resolve)));
      socket.send(frame);
    }
    // Frames on different TCP connections can arrive out of order; whichever crosses the global bound must close.
    expect(await Promise.race([...closed, new Promise((resolve) => setTimeout(() => resolve(0), 3000))])).toBe(4003);
    expect(connect.calls.size).toBe(0);
  });
});
