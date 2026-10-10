/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { APIService } from "@/services/api.service";
const configuration = vi.hoisted(() => ({
  API_BASE_URL: "",
  PUBLIC_ORIGIN: "https://plane.example.org",
  WEB_BASE_URL: "",
}));
vi.mock("@/env", () => ({ env: configuration }));
class Client extends APIService {}
it("forwards separate CSRF cookie, token and canonical Origin for concurrent user writes", async () => {
  const api = createServer((request, response) => {
    const identity = request.headers.cookie?.includes("session-id=first") ? "first" : "second";
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/auth/get-csrf-token/") {
      response.setHeader("Set-Cookie", `csrftoken=cookie-${identity}; HttpOnly; Secure; Path=/`);
      response.end(JSON.stringify({ csrf_token: `token-${identity}` }));
    } else {
      const valid =
        request.headers.origin === configuration.PUBLIC_ORIGIN &&
        request.headers["x-csrftoken"] === `token-${identity}` &&
        request.headers.cookie?.includes(`csrftoken=cookie-${identity}`);
      response.writeHead(valid ? 200 : 403).end(JSON.stringify({ valid }));
    }
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  configuration.API_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  try {
    const first = new Client();
    first.setHeader("Cookie", "session-id=first");
    const second = new Client();
    second.setHeader("Cookie", "session-id=second");
    const results = await Promise.all([first.patch("/write/", {}), second.patch("/write/", {})]);
    expect(results.map((result) => result.data)).toEqual([{ valid: true }, { valid: true }]);
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});
