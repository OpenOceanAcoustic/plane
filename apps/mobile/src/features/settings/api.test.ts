import { describe, expect, it, vi } from "vitest";
import { ApiClient, type RequestData, type Transport } from "../../lib/client";
import { canManage, parseThemeConfiguration, SettingsApi, uploadSettingsImage } from "./api";

describe("mobile settings public HTTP contracts", () => {
  it("accepts desktop theme imports and rejects unsafe colors or invalid palettes", () => {
    expect(
      parseThemeConfiguration('{"version":"1.0","primary":"#006B9E","background":"#ffffff","darkPalette":false}')
    ).toEqual({ theme: "custom", primary: "#006B9E", background: "#ffffff", darkPalette: false });
    expect(() => parseThemeConfiguration('{"primary":"url(https://evil.test)","background":"#ffffff"}')).toThrow();
    expect(() =>
      parseThemeConfiguration('{"primary":"#006B9E","background":"#ffffff","darkPalette":"false"}')
    ).toThrow();
  });
  it("sends workspace invitations with backend roles and normalized email", async () => {
    const requests: RequestData[] = [];
    const transport: Transport = {
      async request(request) {
        requests.push(request);
        return { status: 200, data: request.path.includes("csrf") ? { csrf_token: "token" } : {}, headers: {} };
      },
      async clearSession() {},
    };
    const api = new SettingsApi(new ApiClient("http://example.test", transport));
    await api.invite("research", " Member@Example.test ", "15");
    expect(requests.at(-1)).toMatchObject({
      path: "/api/workspaces/research/invitations/",
      method: "POST",
      data: { emails: [{ email: "member@example.test", role: 15 }] },
      headers: { "X-CSRFToken": "token" },
    });
  });
  it("uses the independent mobile administrator login and refreshes rotated CSRF", async () => {
    const requests: RequestData[] = [];
    const transport: Transport = {
      async request(request) {
        requests.push(request);
        return { status: 200, data: request.path.includes("csrf") ? { csrf_token: "token" } : {}, headers: {} };
      },
      async clearSession() {},
    };
    await new SettingsApi(new ApiClient("https://example.test", transport)).adminLogin("admin", "123456");
    expect(requests.map((request) => request.path)).toEqual([
      "/auth/get-csrf-token/",
      "/auth/lab/mobile/admin/sign-in/",
      "/auth/get-csrf-token/",
    ]);
    expect(requests[1].data).toEqual({ username: "admin", code: "123456" });
  });
  it("restricts settings management to backend administrator roles", () => {
    expect(canManage(20)).toBe(true);
    expect(canManage(15)).toBe(false);
    expect(canManage(5)).toBe(false);
    expect(canManage(undefined)).toBe(false);
  });
  it("writes intake_view because the inbox alias is read-only", async () => {
    const requests: RequestData[] = [];
    const transport: Transport = {
      async request(options) {
        requests.push(options);
        return { status: 200, headers: {}, data: options.path.includes("csrf") ? { csrf_token: "token" } : {} };
      },
      async clearSession() {},
    };
    await new SettingsApi(new ApiClient("http://example.test", transport)).updateProjectFeature(
      "/api/workspaces/test/projects/id/",
      "intake_view",
      true
    );
    expect(requests.at(-1)?.data).toEqual({ intake_view: true });
  });
  it("confirms a profile image only after its credential-free signed upload succeeds", async () => {
    const events: string[] = [];
    const transport: Transport = {
      async request(options) {
        events.push(options.method === "PATCH" ? "confirm" : options.path.includes("csrf") ? "csrf" : "sign");
        return {
          status: 200,
          headers: {},
          data: options.path.includes("csrf")
            ? { csrf_token: "csrf" }
            : { asset_id: "image", upload_data: { url: "https://storage.test/object", fields: { key: "profile" } } },
        };
      },
      async clearSession() {},
      async pickFile() {
        return { fileId: "selected", name: "avatar.png", mimeType: "image/png", size: 100 };
      },
      async uploadFile(options) {
        events.push("upload");
        expect(options).toMatchObject({
          server: "https://storage.test",
          path: "/object",
          signed: true,
          fileId: "selected",
          fields: { key: "profile" },
        });
        return { status: 204, data: null, headers: {} };
      },
    };
    await uploadSettingsImage(
      new ApiClient("http://example.test", transport),
      "/api/assets/v2/user-assets/",
      "USER_AVATAR"
    );
    expect(events).toEqual(["csrf", "sign", "upload", "confirm"]);
    const confirm = vi.fn();
    const failedClient = {
      pickFile: transport.pickFile,
      request: async () => ({ asset_id: "image", upload_data: { url: "https://storage.test/object", fields: {} } }),
      uploadFile: async () => {
        throw new Error("上传中断");
      },
    } as unknown as ApiClient;
    const original = failedClient.request;
    failedClient.request = async (...args) => {
      if (args[1] === "PATCH") confirm();
      return original(...args);
    };
    await expect(uploadSettingsImage(failedClient, "/api/assets/v2/user-assets/", "USER_COVER")).rejects.toThrow(
      "上传中断"
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});
