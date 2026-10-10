import { describe, expect, it } from "vitest";
import { ApiClient, ApiError, normalizeServer, type Transport } from "./client";

function fixture() {
  const calls: string[] = [];
  const transport: Transport = {
    request: async ({ path, headers }) => {
      calls.push(path);
      if (path.includes("csrf")) return { status: 200, data: { csrf_token: "csrf-one" }, headers: {} };
      return { status: 200, data: { sentCsrf: headers?.["X-CSRFToken"] }, headers: {} };
    },
    clearSession: async () => {
      calls.push("clear");
    },
  };
  return { client: new ApiClient("https://example.org", transport), calls };
}

describe("mobile HTTP boundary", () => {
  it("rejects credentials and insecure schemes in server addresses", () => {
    expect(normalizeServer("http://192.168.1.2:8080/")).toBe("http://192.168.1.2:8080");
    expect(() => normalizeServer("https://user:secret@host/")).toThrow();
    expect(() => normalizeServer("file:///private")).toThrow();
    expect(() => normalizeServer("https://example.org/api")).toThrow();
  });
  it("bootstraps CSRF before a write and surfaces denial", async () => {
    const { client, calls } = fixture();
    const value = await client.request<{ sentCsrf: string }>("/api/test/", "POST", { name: "task" });
    expect(value.sentCsrf).toBe("csrf-one");
    expect(calls).toEqual(["/auth/get-csrf-token/", "/api/test/"]);
    const denied = new ApiClient("https://example.org", {
      request: async () => ({ status: 403, data: { error: "forbidden" }, headers: {} }),
      clearSession: async () => {},
    });
    await expect(denied.request("/api/test/")).rejects.toMatchObject({ status: 403 });
  });
  it("refuses dedicated export while preserving JSON queries and document sync", async () => {
    const { client, calls } = fixture();
    await expect(client.request("/api/workspaces/test/lab/planning-export/?format=csv")).rejects.toBeInstanceOf(
      ApiError
    );
    await expect(client.request("/api/workspaces/test/lab/task-table/?format=csv")).rejects.toMatchObject({
      status: 403,
    });
    await client.request("/api/workspaces/test/lab/task-table/");
    await client.request("/api/workspaces/test/projects/id/pages/id/description/");
    expect(calls).toHaveLength(2);
  });
  it("allows ordinary queries for a workspace whose slug contains export", async () => {
    const { client } = fixture();
    await expect(client.request("/api/workspaces/export-lab/projects/")).resolves.toBeDefined();
    await expect(client.request("/api/workspaces/export/projects/")).resolves.toBeDefined();
    await expect(client.request("/api/workspaces/export-lab/export-issues/")).rejects.toMatchObject({ status: 403 });
  });
  it("clears native session before switching deployment", async () => {
    const { client, calls } = fixture();
    await client.switchServer("http://other:8080");
    expect(calls).toEqual(["clear"]);
    expect(client.server).toBe("http://other:8080");
  });
  it("does not send an old form to a newly selected server while CSRF is loading", async () => {
    let complete!: (value: { status: number; data: unknown; headers: Record<string, string> }) => void;
    const calls: string[] = [];
    const transport: Transport = {
      request: async ({ server, path }) => {
        calls.push(`${server}${path}`);
        if (path.includes("csrf"))
          return new Promise((resolve) => {
            complete = resolve;
          });
        return { status: 200, data: {}, headers: {} };
      },
      clearSession: async () => {},
    };
    const client = new ApiClient("https://first.example", transport);
    const saving = client.request("/api/task/", "POST", { name: "private task" });
    await client.switchServer("https://second.example");
    complete({ status: 200, data: { csrf_token: "old-csrf" }, headers: {} });
    await expect(saving).rejects.toMatchObject({ status: 409 });
    expect(calls).toEqual(["https://first.example/auth/get-csrf-token/"]);
  });
  it("surfaces an attachment permission denial rather than reporting a completed download", async () => {
    const client = new ApiClient("https://example.org", {
      request: async () => ({ status: 200, data: {}, headers: {} }),
      clearSession: async () => {},
      download: async () => ({ status: 403, data: { detail: "Attachment access denied" }, headers: {} }),
    });
    await expect(client.download("/api/assets/private/", "brief.pdf")).rejects.toMatchObject({ status: 403 });
  });
  it("discards a previous deployment response after its session is cleared", async () => {
    let complete!: (value: { status: number; data: unknown; headers: Record<string, string> }) => void;
    const client = new ApiClient("https://first.example", {
      request: async () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      clearSession: async () => {},
    });
    const response = client.request("/api/lab/session/");
    await client.switchServer("https://second.example");
    complete({ status: 200, data: { user: { id: "first-account" } }, headers: {} });
    await expect(response).rejects.toMatchObject({ status: 409 });
  });
});
