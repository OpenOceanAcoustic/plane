/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { verifySocketHandshake } from "@/lib/socket-admission";

const configuration = vi.hoisted(() => ({
  PUBLIC_ORIGIN: "https://plane.example.org",
  WEB_BASE_URL: "",
  TRUSTED_PROXY_CIDRS: "",
  LIVE_HANDSHAKE_SOURCE_LIMIT: 2,
  LIVE_HANDSHAKE_GLOBAL_LIMIT: 3,
}));
vi.mock("@/env", () => ({ env: configuration }));
const state = vi.hoisted(() => ({ counters: new Map<string, number>(), failure: false, stalled: false, calls: 0 }));
vi.mock("@/redis", () => ({
  redisManager: {
    getClient: () => ({
      eval: async (_script: string, size: number, ...arguments_: Array<string | number>) => {
        state.calls++;
        if (state.failure) throw new Error("Redis unavailable");
        if (state.stalled) return new Promise(() => {});
        const keys = arguments_.slice(0, size) as string[];
        const limits = arguments_.slice(size) as number[];
        if (keys.some((key, index) => (state.counters.get(key) ?? 0) >= limits[index]!)) return 0;
        for (const key of keys) state.counters.set(key, (state.counters.get(key) ?? 0) + 1);
        return 1;
      },
    }),
  },
}));
vi.mock("@plane/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
async function fixture() {
  state.counters.clear();
  state.failure = false;
  state.stalled = false;
  state.calls = 0;
  configuration.TRUSTED_PROXY_CIDRS = "";
  const http = createServer();
  const sockets = new Set<Socket>();
  http.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const server = new WebSocketServer({ server: http, verifyClient: verifySocketHandshake });
  server.on("connection", (socket) => socket.close());
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return (headers: Record<string, string> = {}) =>
    new Promise<number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${(http.address() as AddressInfo).port}`, {
        headers: { Origin: configuration.PUBLIC_ORIGIN, ...headers },
      });
      socket.once("open", () => {
        socket.close();
        resolve(101);
      });
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        socket.close();
        resolve(response.statusCode!);
      });
      socket.on("error", () => {});
    });
}
describe("admission at the real HTTP WebSocket upgrade", () => {
  it("rejects another Origin before Redis admission", async () => {
    const connect = await fixture();
    expect(await connect({ Origin: "https://evil.example.org" })).toBe(403);
    expect(state.calls).toBe(0);
  });
  it("ignores untrusted forwarding headers when applying the source budget", async () => {
    const connect = await fixture();
    expect(await connect({ "X-Forwarded-For": "192.0.2.1" })).toBe(101);
    expect(await connect({ "X-Forwarded-For": "192.0.2.2" })).toBe(101);
    expect(await connect({ "X-Forwarded-For": "192.0.2.3" })).toBe(429);
  });
  it("uses only the trusted proxy's single normalized source and preserves a global cap", async () => {
    const connect = await fixture();
    configuration.TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
    const statuses = await Promise.all(
      Array.from({ length: 5 }, (_, index) => connect({ "X-Forwarded-For": `192.0.2.${index}` }))
    );
    expect(statuses.filter((status) => status === 101)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    expect(state.counters.size).toBe(4);
  });
  it("rejects the upgrade while Redis is unavailable", async () => {
    const connect = await fixture();
    state.failure = true;
    expect(await connect()).toBe(503);
  });
  it("bounds upgrade waiting time when Redis does not answer", async () => {
    const connect = await fixture();
    state.stalled = true;
    expect(await connect()).toBe(503);
  }, 2000);
});
