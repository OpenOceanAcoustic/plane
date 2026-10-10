import { Capacitor, registerPlugin } from "@capacitor/core";

export type ResponseData = { status: number; data: unknown; headers: Record<string, string> };
export type RequestData = {
  server: string;
  path: string;
  method?: string;
  data?: unknown;
  headers?: Record<string, string>;
  responseType?: "json" | "text" | "base64";
};
export type PickedFile = { fileId: string; name: string; mimeType: string; size: number };
export type DownloadResult =
  | { name: string; uri: string; mimeType: string; status?: number; opened?: boolean }
  | ResponseData;
export type AdminReauthenticationChallenge = { isCurrent: () => boolean };
export interface Transport {
  request(options: RequestData): Promise<ResponseData>;
  clearSession(options: { server?: string }): Promise<unknown>;
  pickFile?(options: { mimeType?: string }): Promise<PickedFile>;
  uploadFile?(options: {
    server: string;
    path: string;
    fileId: string;
    method?: string;
    headers?: Record<string, string>;
    fields?: Record<string, string>;
    signed?: boolean;
  }): Promise<ResponseData>;
  download?(options: {
    server: string;
    path: string;
    name?: string;
    headers?: Record<string, string>;
  }): Promise<DownloadResult>;
  insets?(): Promise<{ top: number; bottom: number; left: number; right: number }>;
  setAppearance?(options: { dark: boolean }): Promise<unknown>;
}
export const nativeTransport = registerPlugin<Transport>("MobileTransport");

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: unknown
  ) {
    const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    super(
      String(
        record.detail ?? record.error ?? record.message ?? (status === 0 ? "无法连接服务器" : `请求失败 (${status})`)
      )
    );
    this.name = "ApiError";
  }
}
export function normalizeServer(input: string): string {
  const url = new URL(input.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("请输入 HTTP 或 HTTPS 部署根地址");
  return url.toString().replace(/\/+$/, "");
}
export function isExportPath(path: string): boolean {
  const url = new URL(path, "https://mobile.invalid");
  const parts = url.pathname.split("/").filter(Boolean);
  return (
    parts.some((part, index) => parts[index - 1] !== "workspaces" && /^(?:export(?:-|$)|.*-export$)/i.test(part)) ||
    ["csv", "xlsx", "xls", "pdf", "png", "svg"].includes(url.searchParams.get("format")?.toLowerCase() ?? "")
  );
}
const browserFiles = new Map<string, File>();
const browserTransport: Transport = {
  async request(options) {
    const url = new URL(options.path, `${options.server}/`);
    const preview = import.meta.env.DEV && url.hostname === "127.0.0.1" && url.port === "18100";
    const response = await fetch(preview ? `${url.pathname}${url.search}` : url, {
      method: options.method ?? "GET",
      headers: options.headers,
      credentials: "include",
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
    });
    const headers = Object.fromEntries(response.headers.entries());
    let data: unknown;
    if (options.responseType === "base64") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      data = btoa(Array.from(bytes, (c) => String.fromCharCode(c)).join(""));
    } else if (options.responseType === "text") data = await response.text();
    else {
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
    }
    return { status: response.status, data, headers };
  },
  async clearSession() {
    browserFiles.clear();
  },
  pickFile: ({ mimeType }) =>
    new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = mimeType ?? "*/*";
      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0];
          if (!file) return reject(new Error("已取消"));
          const fileId = crypto.randomUUID();
          browserFiles.set(fileId, file);
          resolve({ fileId, name: file.name, mimeType: file.type || "application/octet-stream", size: file.size });
        },
        { once: true }
      );
      input.addEventListener("cancel", () => reject(new Error("已取消")), { once: true });
      input.click();
    }),
  async uploadFile(options) {
    const file = browserFiles.get(options.fileId);
    if (!file) throw new Error("请重新选择文件");
    const data = new FormData();
    Object.entries(options.fields ?? {}).forEach(([key, value]) => data.append(key, value));
    data.append("file", file);
    const response = await fetch(new URL(options.path, `${options.server}/`), {
      method: options.method ?? "POST",
      headers: options.headers,
      body: data,
      credentials: options.signed ? "omit" : "include",
    });
    return { status: response.status, data: await response.text(), headers: {} };
  },
  async download({ server, path, name }) {
    const url = new URL(path, `${server}/`);
    window.open(url, "_blank", "noopener");
    return { name: name ?? "附件", uri: url.toString(), mimeType: "application/octet-stream" };
  },
};

export class ApiClient {
  private generation = 0;
  private csrf?: string;
  private csrfPending?: Promise<void>;
  private adminReauthenticationPending?: Promise<void>;
  private adminReauthenticationRevision = 0;
  onSessionExpired?: () => void;
  onAdminReauthenticationRequired?: (challenge: AdminReauthenticationChallenge) => Promise<void>;
  constructor(
    public server: string,
    private transport: Transport = Capacitor.isNativePlatform() ? nativeTransport : browserTransport
  ) {
    this.server = normalizeServer(server);
  }
  private async send(
    path: string,
    method: string,
    data?: unknown,
    responseType: RequestData["responseType"] = "json"
  ): Promise<ResponseData> {
    const generation = this.generation;
    if (!path.startsWith("/") || path.startsWith("//") || isExportPath(path))
      throw new ApiError(403, { error: "手机端不支持导出数据" });
    const headers: Record<string, string> = { Accept: "application/json" };
    if (data !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrf && !["GET", "HEAD", "OPTIONS"].includes(method)) headers["X-CSRFToken"] = this.csrf;
    let response: ResponseData;
    try {
      response = await this.transport.request({ server: this.server, path, method, data, headers, responseType });
    } catch (error) {
      throw error instanceof ApiError
        ? error
        : new ApiError(0, { detail: error instanceof Error ? error.message : "无法连接服务器" });
    }
    if (generation !== this.generation) throw new ApiError(409, { error: "服务器连接已变更" });
    if (response.status >= 400) {
      const code = this.responseCode(response.data);
      if (response.status === 401 && !(path === "/auth/lab/admin/reauthenticate/" && code === "INVALID_CREDENTIALS"))
        this.onSessionExpired?.();
      throw new ApiError(response.status, response.data);
    }
    return response;
  }
  async refreshCsrf(): Promise<void> {
    const generation = this.generation;
    const pending =
      this.csrfPending ??
      this.send("/auth/get-csrf-token/", "GET")
        .then(({ data }) => {
          if (generation === this.generation) this.csrf = (data as { csrf_token: string }).csrf_token;
          return undefined;
        })
        .finally(() => {
          if (this.csrfPending === pending) this.csrfPending = undefined;
        });
    this.csrfPending = pending;
    await pending;
  }
  async request<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
    const generation = this.generation;
    const server = this.server;
    const reauthenticationRevision = this.adminReauthenticationRevision;
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !this.csrf) await this.refreshCsrf();
    const isCurrent = () => generation === this.generation && server === this.server;
    if (!isCurrent()) throw new ApiError(409, { error: "服务器已切换，请重新打开表单" });
    try {
      return (await this.send(path, method, body)).data as T;
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status !== 403 ||
        this.responseCode(error.data) !== "ADMIN_REAUTH_REQUIRED" ||
        ["GET", "HEAD", "OPTIONS"].includes(method) ||
        path === "/auth/lab/admin/reauthenticate/" ||
        !this.onAdminReauthenticationRequired
      )
        throw error;
      if (!isCurrent()) throw new ApiError(409, { error: "服务器已切换，请重新打开表单" });
      if (reauthenticationRevision === this.adminReauthenticationRevision) {
        const required = this.onAdminReauthenticationRequired;
        const pending =
          this.adminReauthenticationPending ??
          Promise.resolve()
            .then(() => {
              if (!isCurrent()) throw new ApiError(409, { error: "服务器已切换，请重新打开表单" });
              if (this.onAdminReauthenticationRequired !== required)
                throw new ApiError(403, { code: "ADMIN_REAUTH_REQUIRED", error: "已取消动态码验证" });
              return required({ isCurrent });
            })
            .then(() => {
              if (isCurrent()) this.adminReauthenticationRevision++;
              return undefined;
            })
            .finally(() => {
              if (this.adminReauthenticationPending === pending) this.adminReauthenticationPending = undefined;
            });
        this.adminReauthenticationPending = pending;
        await pending;
      }
      if (!isCurrent()) throw new ApiError(409, { error: "服务器已切换，请重新打开表单" });
      // Replay only once with the original body, including its idempotency key.
      return (await this.send(path, method, body)).data as T;
    }
  }
  private responseCode(data: unknown): unknown {
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>).code : undefined;
  }
  async binary(path: string): Promise<Uint8Array> {
    const data = (await this.send(path, "GET", undefined, "base64")).data as string;
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  }
  async switchServer(server: string): Promise<void> {
    const normalized = normalizeServer(server);
    await this.clearSession();
    this.server = normalized;
  }
  async clearSession(): Promise<void> {
    this.generation++;
    this.csrf = undefined;
    this.csrfPending = undefined;
    this.adminReauthenticationPending = undefined;
    this.adminReauthenticationRevision = 0;
    await this.transport.clearSession({ server: this.server });
  }
  async pickFile(mimeType?: string): Promise<PickedFile> {
    if (!this.transport.pickFile) throw new Error("文件选择不可用");
    return this.transport.pickFile({ mimeType });
  }
  async uploadFile(path: string, file: PickedFile, fields?: Record<string, string>): Promise<void> {
    if (!this.transport.uploadFile) throw new Error("文件上传不可用");
    const url = new URL(path, `${this.server}/`);
    const result = await this.transport.uploadFile({
      server: url.origin,
      path: `${url.pathname}${url.search}`,
      fileId: file.fileId,
      fields,
      signed: true,
    });
    if (result.status >= 400) throw new ApiError(result.status, result.data);
  }
  async uploadAttachment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    file?: PickedFile
  ): Promise<unknown> {
    const picked = file ?? (await this.pickFile());
    const path = `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/attachments/`;
    const signed = await this.request<{
      asset_id: string;
      upload_data: { url: string; fields: Record<string, string> };
      attachment: unknown;
    }>(path, "POST", { name: picked.name, type: picked.mimeType, size: picked.size });
    await this.uploadFile(signed.upload_data.url, picked, signed.upload_data.fields);
    await this.request(`${path}${signed.asset_id}/`, "PATCH");
    return signed.attachment;
  }
  async download(path: string, name?: string): Promise<unknown> {
    if (isExportPath(path)) throw new ApiError(403, { error: "手机端不支持导出数据" });
    if (!this.transport.download) throw new Error("附件下载不可用");
    const result = await this.transport.download({ server: this.server, path, name });
    if (result.status !== undefined && result.status >= 400)
      throw new ApiError(result.status, "data" in result ? result.data : {});
    if ("opened" in result && result.opened === false)
      window.dispatchEvent(new CustomEvent("mobileNotice", { detail: "附件已保存，手机未安装可打开此文件的应用" }));
    return result;
  }
}
