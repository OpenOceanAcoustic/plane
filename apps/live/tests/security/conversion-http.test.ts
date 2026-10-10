/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { conversionPool } from "@/lib/conversion-pool";
import express from "express";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { DocumentController } from "@/controllers/document.controller";
const counters = vi.hoisted(() => new Map<string, number>());
vi.mock("@/redis", () => ({
  redisManager: {
    getClient: () => ({
      eval: async (_script: string, _keys: number, key: string) => {
        const value = (counters.get(key) ?? 0) + 1;
        counters.set(key, value);
        return value;
      },
    }),
  },
}));
const configuration = vi.hoisted(() => ({
  API_BASE_URL: "http://127.0.0.1:1",
  PUBLIC_ORIGIN: "https://plane.example.org",
  WEB_BASE_URL: "",
}));
vi.mock("@/env", () => ({ env: configuration }));
vi.mock("@plane/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
it("rejects anonymous document conversion over HTTP", async () => {
  const app = express();
  app.use(express.json());
  const controller = new DocumentController();
  app.post("/live/convert-document/", (request, response) => {
    void controller.convertDocument(request, response);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/live/convert-document/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: configuration.PUBLIC_ORIGIN },
      body: JSON.stringify({ description_html: "<p>Small valid document</p>", variant: "rich" }),
    });
    expect(response.status).toBe(401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("converts authenticated documents in real worker threads and rejects the eleventh request", async () => {
  counters.clear();
  const api = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "test-owner", display_name: "Test owner" }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  configuration.API_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const app = express();
  app.use(express.json());
  const controller = new DocumentController();
  app.post("/live/convert-document/", (request, response) => {
    void controller.convertDocument(request, response);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/live/convert-document/`;
    for (let index = 0; index < 10; index++) {
      // oxlint-disable-next-line no-await-in-loop -- Complete each conversion before the next request to isolate the user quota from queue backpressure.
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "session-id=test", Origin: configuration.PUBLIC_ORIGIN },
        body: JSON.stringify({ description_html: "<p>Worker conversion fixture</p>", variant: "rich" }),
      });
      expect(response.status).toBe(200);
      // oxlint-disable-next-line no-await-in-loop -- Assert and drain this response before advancing the sequential quota scenario.
      expect(JSON.stringify(await response.json())).toContain("Worker conversion fixture");
    }
    const blocked = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "session-id=test", Origin: configuration.PUBLIC_ORIGIN },
      body: JSON.stringify({ description_html: "<p>Blocked</p>", variant: "rich" }),
    });
    expect(blocked.status).toBe(429);
  } finally {
    await conversionPool.destroy();
    server.closeAllConnections();
    api.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => api.close(() => resolve())),
    ]);
  }
}, 20000);

it("returns backpressure over HTTP when the real worker queue is full", async () => {
  counters.clear();
  const api = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    const id = request.headers.cookie?.split("=")[1];
    response.end(JSON.stringify({ id, display_name: id }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  configuration.API_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const app = express();
  app.use(express.json());
  const controller = new DocumentController();
  app.post("/live/convert-document/", (request, response) => {
    void controller.convertDocument(request, response);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/live/convert-document/`;
    const statuses = await Promise.all(
      Array.from({ length: 30 }, async (_, index) => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `session-id=queue-${Math.floor(index / 10)}`,
            Origin: configuration.PUBLIC_ORIGIN,
          },
          body: JSON.stringify({ description_html: `<p>${"x".repeat(100000)}</p>`, variant: "rich" }),
        });
        await response.arrayBuffer();
        return response.status;
      })
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(22);
    expect(statuses.filter((status) => status === 503)).toHaveLength(8);
  } finally {
    await conversionPool.destroy();
    server.closeAllConnections();
    api.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => api.close(() => resolve())),
    ]);
  }
}, 20000);
