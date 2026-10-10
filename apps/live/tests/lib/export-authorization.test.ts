/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeDataExport } from "@/lib/export-authorization";
import { UserService } from "@/services/user.service";

vi.mock("@/services/user.service", () => ({ UserService: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe("live document export authorization", () => {
  it("rejects a real Android session before any page content or PDF is generated", async () => {
    const currentSession = vi
      .fn()
      .mockResolvedValue({ client_platform: "android", capabilities: { data_export: false } });
    vi.mocked(UserService).mockImplementation(function () {
      return { currentSession } as never;
    });
    await expect(authorizeDataExport("session-id=android")).rejects.toMatchObject({
      statusCode: 403,
      code: "mobile_export_disabled",
    });
    expect(currentSession).toHaveBeenCalledWith("session-id=android");
  });

  it("retains export for browser sessions and fails closed for invalid capabilities", async () => {
    const currentSession = vi
      .fn()
      .mockResolvedValueOnce({ client_platform: "web", capabilities: { data_export: true } })
      .mockResolvedValueOnce({});
    vi.mocked(UserService).mockImplementation(function () {
      return { currentSession } as never;
    });
    await expect(authorizeDataExport("session-id=web")).resolves.toBeUndefined();
    await expect(authorizeDataExport("session-id=unknown")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("requires a valid persisted session instead of trusting request client headers", async () => {
    vi.mocked(UserService).mockImplementation(function () {
      return { currentSession: vi.fn().mockRejectedValue(new Error("invalid session")) } as never;
    });
    await expect(authorizeDataExport("session-id=expired")).rejects.toThrow("invalid session");
  });
});
