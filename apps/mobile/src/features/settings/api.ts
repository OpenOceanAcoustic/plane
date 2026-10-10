import type { ApiClient } from "../../lib/client";

export const roleOptions = [
  { value: "20", label: "管理员" },
  { value: "15", label: "成员" },
  { value: "5", label: "访客" },
];
export const stateOptions = [
  { value: "backlog", label: "待办" },
  { value: "unstarted", label: "未开始" },
  { value: "started", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];
export function roleName(role: unknown): string {
  return roleOptions.find((option) => option.value === String(role))?.label ?? "成员";
}
export function canManage(role: unknown): boolean {
  return Number(role) >= 20;
}

export class SettingsApi {
  constructor(private client: ApiClient) {}
  updatePersonal(values: Record<string, string>) {
    return this.client.request("/api/users/me/", "PATCH", values);
  }
  updateProjectFeature(base: string, feature: string, enabled: boolean) {
    return this.client.request(base, "PATCH", { [feature]: enabled });
  }
  invite(workspaceSlug: string, email: string, role: string) {
    return this.client.request(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations/`, "POST", {
      emails: [{ email: email.trim().toLowerCase(), role: Number(role) }],
    });
  }
  addProjectMember(workspaceSlug: string, projectId: string, memberId: string, role: string) {
    return this.client.request(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/members/`,
      "POST",
      { members: [{ member_id: memberId, role: Number(role) }] }
    );
  }
  async adminLogin(username: string, code: string) {
    await this.client.request("/auth/lab/mobile/admin/sign-in/", "POST", { username: username.trim(), code });
    await this.client.refreshCsrf();
  }
}

export async function uploadSettingsImage(client: ApiClient, path: string, entityType: string, identifier?: string) {
  const file = await client.pickFile("image/*");
  if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/jpg"].includes(file.mimeType))
    throw new Error("请选择 JPEG、PNG、WebP 或 GIF 图片");
  const signed = await client.request<{
    asset_id: string;
    upload_data: { url: string; fields: Record<string, string> };
  }>(path, "POST", {
    entity_type: entityType,
    entity_identifier: identifier,
    name: file.name,
    type: file.mimeType,
    size: file.size,
  });
  await client.uploadFile(signed.upload_data.url, file, signed.upload_data.fields);
  await client.request(`${path}${signed.asset_id}/`, "PATCH");
}

export function parseThemeConfiguration(text: string) {
  if (text.length > 65536) throw new Error("主题配置文件不能超过 64 KB");
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("主题配置格式无效");
  const config = value as Record<string, unknown>;
  if (
    typeof config.primary !== "string" ||
    typeof config.background !== "string" ||
    ![config.primary, config.background].every((color) => /^#[0-9a-f]{6}$/i.test(color)) ||
    (config.darkPalette !== undefined && typeof config.darkPalette !== "boolean")
  )
    throw new Error("主题配置的颜色或色调无效");
  return {
    theme: "custom" as const,
    primary: config.primary,
    background: config.background,
    darkPalette: config.darkPalette === true,
  };
}
