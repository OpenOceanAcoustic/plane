/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import express from "express";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { requestLogger } from "@/lib/request-logger";

it("logs HTTP metadata without cookie, token, query or body credentials", async () => {
  const messages: string[] = [];
  const stream = (console as unknown as { _stdout: { write(value: unknown): boolean } })._stdout;
  const output = vi.spyOn(stream, "write").mockImplementation((value) => {
    messages.push(String(value));
    return true;
  });
  const app = express();
  app.use(requestLogger);
  app.use(express.json());
  app.post("/fixture/", (_request, response) => response.status(204).end());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture/?token=query-secret`, {
      method: "POST",
      headers: {
        Cookie: "session-id=cookie-secret",
        Authorization: "Bearer authorization-secret",
        "X-CSRFToken": "csrf-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "body-secret" }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const log = messages.join("");
    expect(log).toContain("204");
    expect(log).not.toMatch(/cookie-secret|authorization-secret|csrf-secret|query-secret|body-secret/);
  } finally {
    output.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
