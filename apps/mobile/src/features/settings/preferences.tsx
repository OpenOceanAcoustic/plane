import { useState } from "react";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Sheet,
  records,
  textValue,
  useData,
  type Entity,
  type FormField,
} from "../../components/ui";
import type { ApiClient } from "../../lib/client";
import { parseThemeConfiguration } from "./api";

export type MobileTheme = {
  theme: "light" | "dark" | "system" | "custom";
  primary?: string;
  background?: string;
  darkPalette?: boolean;
};
export type ThemeChange = (theme: MobileTheme["theme"], custom?: Record<string, string>) => void;
const booleanOptions = [
  { value: "true", label: "开启" },
  { value: "false", label: "关闭" },
];
const languageOptions = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "ja", label: "日本語" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ru", label: "Русский" },
  { value: "it", label: "Italian" },
  { value: "cs", label: "Čeština" },
  { value: "sk", label: "Slovenčina" },
  { value: "de", label: "Deutsch" },
  { value: "ua", label: "Українська" },
  { value: "pl", label: "Polski" },
  { value: "ko", label: "한국어" },
  { value: "pt-BR", label: "Português Brasil" },
  { value: "id", label: "Indonesian" },
  { value: "ro", label: "Română" },
  { value: "vi-VN", label: "Tiếng việt" },
  { value: "tr-TR", label: "Türkçe" },
];

export function PreferencesSettings({ client, onThemeChange }: { client: ApiClient; onThemeChange?: ThemeChange }) {
  const profile = useData<Entity>(client, "/api/users/me/profile/");
  const user = useData<Entity>(client, "/api/users/me/");
  const [editor, setEditor] = useState<{
    title: string;
    fields: FormField[];
    submit: (values: Record<string, string>) => Promise<unknown>;
  }>();
  const theme = (profile.data?.theme ?? {}) as Partial<MobileTheme>;
  const [importError, setImportError] = useState<unknown>();
  const [importing, setImporting] = useState(false);
  const saveTheme = async (next: MobileTheme) => {
    await client.request("/api/users/me/profile/", "PATCH", { theme: next });
    onThemeChange?.(
      next.theme,
      next.theme === "custom"
        ? {
            primary: next.primary!,
            background: next.background!,
            text: next.darkPalette ? "#edf2fc" : "#18304e",
            darkPalette: String(Boolean(next.darkPalette)),
          }
        : undefined
    );
    await profile.refresh();
  };
  return (
    <>
      <article className="card">
        <h2>偏好设置</h2>
        <dl className="record-fields">
          <div>
            <dt>账号语言偏好</dt>
            <dd>
              {languageOptions.find((option) => option.value === profile.data?.language)?.label ??
                textValue(profile.data?.language)}
            </dd>
          </div>
          <div>
            <dt>每周开始日</dt>
            <dd>
              {["周日", "周一", "周二", "周三", "周四", "周五", "周六"][Number(profile.data?.start_of_the_week ?? 0)]}
            </dd>
          </div>
          <div>
            <dt>时区</dt>
            <dd>{textValue(user.data?.user_timezone)}</dd>
          </div>
          <div>
            <dt>通知显示</dt>
            <dd>{profile.data?.notification_view_mode === "compact" ? "紧凑" : "完整"}</dd>
          </div>
        </dl>
        <button
          className="button"
          onClick={() =>
            setEditor({
              title: "偏好设置",
              fields: [
                {
                  key: "language",
                  label: "账号语言偏好",
                  type: "select",
                  value: profile.data?.language ?? "zh-CN",
                  options: languageOptions,
                },
                {
                  key: "start_of_the_week",
                  label: "每周开始日",
                  type: "select",
                  value: profile.data?.start_of_the_week ?? 0,
                  options: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map((label, i) => ({
                    value: String(i),
                    label,
                  })),
                },
                {
                  key: "notification_view_mode",
                  label: "通知显示",
                  type: "select",
                  value: profile.data?.notification_view_mode ?? "full",
                  options: [
                    { value: "full", label: "完整" },
                    { value: "compact", label: "紧凑" },
                  ],
                },
                {
                  key: "user_timezone",
                  label: "时区",
                  value: user.data?.user_timezone ?? "Asia/Shanghai",
                  required: true,
                },
                {
                  key: "mobile_timezone_auto_set",
                  label: "自动设置手机时区",
                  type: "select",
                  value: Boolean(profile.data?.mobile_timezone_auto_set),
                  options: booleanOptions,
                },
              ],
              submit: async (values) => {
                const timezone =
                  values.mobile_timezone_auto_set === "true"
                    ? Intl.DateTimeFormat().resolvedOptions().timeZone
                    : values.user_timezone;
                new Intl.DateTimeFormat("zh-CN", { timeZone: timezone }).format();
                await client.request("/api/users/me/profile/", "PATCH", {
                  language: values.language,
                  start_of_the_week: Number(values.start_of_the_week),
                  notification_view_mode: values.notification_view_mode,
                  mobile_timezone_auto_set: values.mobile_timezone_auto_set === "true",
                });
                await client.request("/api/users/me/", "PATCH", { user_timezone: timezone });
                await profile.refresh();
                await user.refresh();
              },
            })
          }
        >
          编辑偏好
        </button>
        <ErrorMessage error={profile.error} />
      </article>
      <article className="card">
        <h2>主题</h2>
        <div className="actions">
          {(["light", "dark", "system"] as const).map((value, i) => (
            <ActionButton
              key={value}
              className={`button ${theme.theme === value ? "primary" : ""}`}
              action={() => saveTheme({ theme: value })}
            >
              {["浅色", "深色", "跟随系统"][i]}
            </ActionButton>
          ))}
          <ActionButton
            action={() => saveTheme({ theme: "custom", primary: "#0047ab", background: "#ffffff", darkPalette: false })}
          >
            浅色高对比度
          </ActionButton>
          <ActionButton
            action={() => saveTheme({ theme: "custom", primary: "#80c7ff", background: "#080e17", darkPalette: true })}
          >
            深色高对比度
          </ActionButton>
          <button
            className="button"
            onClick={() =>
              setEditor({
                title: "自定义主题",
                fields: [
                  { key: "primary", label: "主题色（#RRGGBB）", value: theme.primary ?? "#3f76ff", required: true },
                  {
                    key: "background",
                    label: "背景色（#RRGGBB）",
                    value: theme.background ?? "#ffffff",
                    required: true,
                  },
                  {
                    key: "darkPalette",
                    label: "深色文字配色",
                    type: "select",
                    value: Boolean(theme.darkPalette),
                    options: [
                      { value: "true", label: "深色背景" },
                      { value: "false", label: "浅色背景" },
                    ],
                  },
                ],
                submit: async (values) => {
                  if (![values.primary, values.background].every((v) => /^#[0-9a-f]{6}$/i.test(v)))
                    throw new Error("请输入六位十六进制颜色");
                  await saveTheme({
                    theme: "custom",
                    primary: values.primary,
                    background: values.background,
                    darkPalette: values.darkPalette === "true",
                  });
                },
              })
            }
          >
            自定义主题
          </button>
          <label className="field">
            <span>{importing ? "正在导入…" : "导入主题配置"}</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={importing}
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setImportError(undefined);
                setImporting(true);
                try {
                  if (file.size > 65536) throw new Error("主题配置文件不能超过 64 KB");
                  await saveTheme(parseThemeConfiguration(await file.text()));
                } catch (error) {
                  setImportError(error);
                } finally {
                  input.value = "";
                  setImporting(false);
                }
              }}
            />
          </label>
        </div>
        <ErrorMessage error={importError} />
      </article>
      {editor && <FormSheet {...editor} onSubmit={editor.submit} onClose={() => setEditor(undefined)} />}
    </>
  );
}

export function ApiTokenSettings({ client }: { client: ApiClient }) {
  const tokens = useData(client, "/api/users/api-tokens/");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string>();
  const [deleting, setDeleting] = useState<Entity>();
  return (
    <article className="card">
      <h2>API 令牌</h2>
      <button className="button" onClick={() => setCreating(true)}>
        创建令牌
      </button>
      <div className="list">
        {records(tokens.data).map((token) => (
          <article className="card" key={token.id}>
            <h3>{textValue(token.label)}</h3>
            <p>{textValue(token.description)}</p>
            <p>到期：{token.expired_at ? new Date(String(token.expired_at)).toLocaleString() : "无期限"}</p>
            <button className="button danger" onClick={() => setDeleting(token)}>
              撤销
            </button>
          </article>
        ))}
      </div>
      <ErrorMessage error={tokens.error} />
      {creating && (
        <FormSheet
          title="创建 API 令牌"
          fields={[
            { key: "label", label: "名称", required: true },
            { key: "description", label: "描述", type: "textarea" },
            { key: "expired_at", label: "到期时间（留空不限）", type: "datetime-local" },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            const created = await client.request<Entity>("/api/users/api-tokens/", "POST", {
              label: values.label,
              description: values.description,
              expired_at: values.expired_at ? new Date(values.expired_at).toISOString() : null,
            });
            setSecret(String(created.token));
            await tokens.refresh();
          }}
        />
      )}
      {secret && (
        <Sheet title="新令牌" onClose={() => setSecret(undefined)}>
          <p>此令牌只显示一次。</p>
          <p className="value" style={{ overflowWrap: "anywhere", userSelect: "text" }}>
            {secret}
          </p>
          <ActionButton action={() => navigator.clipboard.writeText(secret)}>复制令牌</ActionButton>
        </Sheet>
      )}
      {deleting && (
        <Sheet title={`撤销 ${textValue(deleting.label)}？`} onClose={() => setDeleting(undefined)}>
          <ActionButton
            className="button danger"
            action={async () => {
              await client.request(`/api/users/api-tokens/${deleting.id}/`, "DELETE");
              await tokens.refresh();
            }}
            onDone={() => setDeleting(undefined)}
          >
            确认撤销
          </ActionButton>
        </Sheet>
      )}
    </article>
  );
}
