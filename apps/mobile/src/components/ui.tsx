import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import sanitizeHtml from "sanitize-html";
import type { ApiClient } from "../lib/client";
import { isTopDialog } from "../lib/dialog";
import { MobileClientContext, RichHtmlEditor, resolveImage } from "./rich-editor";
import { CanonicalIcon, MobileHeaderContext } from "./navigation";

export type Entity = Record<string, unknown> & { id?: string; name?: string };
export function records(data: unknown): Entity[] {
  if (Array.isArray(data)) return data as Entity[];
  if (data && typeof data === "object") {
    const value = data as Entity;
    return records(value.results ?? value.data ?? value.items ?? []);
  }
  return [];
}
export function textValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map(textValue).join("、");
    const v = value as Entity;
    return String(v.display_name ?? v.name ?? v.title ?? v.username ?? v.id ?? "—");
  }
  return String(value);
}
export function useData<T = unknown>(client: ApiClient, path: string | null) {
  const { data, error, isLoading, mutate } = useSWR<T>(
    path ? [client.server, path] : null,
    () => client.request<T>(path!),
    { refreshInterval: 30000, revalidateOnFocus: true, shouldRetryOnError: false }
  );
  return { data, error: error as Error | undefined, loading: isLoading, refresh: mutate };
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {error instanceof Error ? error.message : textValue(error)}
    </p>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      正在加载
    </div>
  );
}
export function Html({ html }: { html?: unknown }) {
  const client = useContext(MobileClientContext);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!client) return;
    let active = true;
    const urls: string[] = [];
    ref.current?.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      void resolveImage(client, image.getAttribute("src") ?? "")
        .then((url) => {
          if (url.startsWith("blob:")) {
            if (active) urls.push(url);
            else URL.revokeObjectURL(url);
          }
          if (active) image.src = url;
          return undefined;
        })
        .catch(() => {
          image.alt = "图片加载失败";
          return undefined;
        });
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [client, html]);
  return (
    <div
      ref={ref}
      className="rich-content"
      dangerouslySetInnerHTML={{
        __html: sanitizeHtml(String(html ?? ""), {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
          allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ["src", "alt", "width", "height"] },
          allowedSchemes: ["https", "http"],
        }),
      }}
    />
  );
}
export function PageHeading({
  title,
  children,
  onBack,
  inline = false,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  onBack?: () => void;
  inline?: boolean;
}) {
  const header = useContext(MobileHeaderContext);
  if (header?.title && !inline)
    return (
      <>
        {createPortal(
          <>
            <h1>{title}</h1>
            {subtitle && <small className="header-project-code">{subtitle}</small>}
          </>,
          header.title
        )}
        {children && header.actions && createPortal(children, header.actions)}
        {onBack &&
          header.back &&
          createPortal(
            <button className="icon-button m3-icon-button" onClick={() => header.onBack(onBack)} aria-label="返回">
              <CanonicalIcon
                name={header.backIconRotated ? "arrow" : "back"}
                size={header.backIconSize}
                style={header.backIconRotated ? { transform: "rotate(180deg)" } : undefined}
              />
            </button>,
            header.back
          )}
      </>
    );
  return (
    <div className="page-heading">
      {onBack && (
        <button className="icon-button" onClick={onBack} aria-label="返回">
          <CanonicalIcon name="back" size={24} />
        </button>
      )}
      <div>
        <h1>{title}</h1>
        {subtitle && <small className="header-project-code">{subtitle}</small>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
const recordFieldLabels: Record<string, string> = {
  updated_at: "更新时间",
  created_at: "创建时间",
  created_by: "创建者",
  updated_by: "更新者",
  access: "访问权限",
  is_locked: "编辑权限",
  identifier: "标识",
  project: "项目",
  project_id: "项目",
  name: "名称",
  description: "描述",
  status: "状态",
  status_code: "响应状态码",
  request_method: "请求方式",
  response_body: "响应内容",
  priority: "优先级",
  state: "状态",
  state_id: "状态",
  start_date: "开始日期",
  target_date: "截止日期",
  completed_at: "完成时间",
  archived_at: "归档时间",
  role: "角色",
  network: "可见性",
  email: "联系邮箱",
  username: "用户名",
  display_name: "显示姓名",
  total_issues: "任务数",
  total_members: "成员数",
  total_cycles: "周期数",
  total_modules: "模块数",
  is_favorite: "收藏",
};
function recordDate(value: unknown): string {
  if (!value) return "未设置";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "未设置"
    : date.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function recordFieldValue(item: Entity, key: string): string {
  const value = item[key];
  if (value == null) return "未设置";
  if (key === "access") return Number(value) === 1 ? "项目成员" : "私人";
  if (key === "is_locked") return value ? "冻结" : "可编辑";
  if (key === "is_favorite") return value ? "已收藏" : "未收藏";
  if (key === "role") return Number(value) >= 20 ? "管理员" : Number(value) >= 15 ? "成员" : "访客";
  if (key === "network") return Number(value) === 2 ? "工作区公开" : "私有项目";
  if (/_at$|_date$/.test(key)) return recordDate(value);
  if (key === "created_by" || key === "updated_by") {
    const person = item[`${key}_detail`] ?? value;
    return typeof person === "object"
      ? textValue(person)
      : typeof person === "string" && /^[a-f0-9-]{36}$/i.test(person)
        ? "成员"
        : textValue(person);
  }
  if (key === "status" && typeof value === "string")
    return (
      (
        {
          success: "成功",
          failed: "失败",
          failure: "失败",
          error: "失败",
          pending: "等待中",
          retrying: "重试中",
          completed: "完成",
          cancelled: "已取消",
        } as Record<string, string>
      )[value] ?? value
    );
  return textValue(value);
}
export function RecordList({
  data,
  fields,
  onOpen,
}: {
  data: unknown;
  fields?: string[];
  onOpen?: (item: Entity) => void;
}) {
  const items = records(data);
  if (!items.length) return <p className="empty">暂无记录</p>;
  return (
    <div className="list">
      {items.map((item) => (
        <article className="card" key={item.id ?? JSON.stringify(item)}>
          {onOpen ? (
            <button className="record-title" onClick={() => onOpen(item)}>
              {textValue(
                item.name ?? item.title ?? item.display_name ?? (item.created_at ? recordDate(item.created_at) : "记录")
              )}
            </button>
          ) : (
            <h3>
              {textValue(
                item.name ?? item.title ?? item.display_name ?? (item.created_at ? recordDate(item.created_at) : "记录")
              )}
            </h3>
          )}
          <dl className="record-fields">
            {(
              fields ??
              Object.keys(item).filter(
                (key) =>
                  !["name", "display_name"].includes(key) && (recordFieldLabels[key] || /[\u3400-\u9fff]/.test(key))
              )
            ).map((key) => (
              <div key={key}>
                <dt>{recordFieldLabels[key] ?? key}</dt>
                <dd>{recordFieldValue(item, key)}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}
export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  busy = false,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClose, busy });
  callbacks.current = { onClose, busy };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const close = (event: Event) => {
      if (event.defaultPrevented || !isTopDialog(ref.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!callbacks.current.busy) callbacks.current.onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (!isTopDialog(ref.current)) return;
      if (event.key === "Escape") {
        close(event);
      }
      if (event.key === "Tab") {
        const targets = ref.current?.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href]");
        if (!targets?.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("mobileBack", close, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mobileBack", close, true);
      window.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay">
      <button className="scrim" onClick={onClose} disabled={busy} aria-label="关闭面板" />
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="handle" />
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose} disabled={busy}>
            <CanonicalIcon name="close" size={22} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export type FormField = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "rich" | "select" | "number" | "date" | "datetime-local" | "email" | "password" | "url";
  options?: { value: string; label: string }[];
  value?: unknown;
  required?: boolean;
  placeholder?: string;
};
export function FormSheet({
  title,
  fields,
  onSubmit,
  onClose,
}: {
  title: string;
  fields: FormField[];
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value == null ? "" : String(f.value)]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Sheet title={title} onClose={onClose} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(undefined);
          try {
            const missing = fields.find(
              (field) =>
                field.required &&
                field.type === "rich" &&
                !sanitizeHtml(values[field.key] ?? "", { allowedTags: [], allowedAttributes: {} }).trim()
            );
            if (missing) throw new Error(`请填写${missing.label}`);
            await onSubmit(values);
            onClose();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {fields.map((field) => (
          <label className="field" key={field.key}>
            <span>{field.label}</span>
            {field.type === "rich" ? (
              <RichHtmlEditor
                value={values[field.key]}
                onChange={(html) => setValues({ ...values, [field.key]: html })}
              />
            ) : field.type === "textarea" ? (
              <textarea
                aria-label={field.label}
                value={values[field.key]}
                required={field.required}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              />
            ) : field.type === "select" ? (
              <select
                aria-label={field.label}
                value={values[field.key]}
                required={field.required}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              >
                <option value="">请选择</option>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={field.label}
                type={field.type ?? "text"}
                value={values[field.key]}
                required={field.required}
                placeholder={field.placeholder}
                step="any"
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              />
            )}
          </label>
        ))}
        <ErrorMessage error={error} />
        <button className="button primary" disabled={busy} type="submit">
          {busy ? "正在保存…" : "保存"}
        </button>
      </form>
    </Sheet>
  );
}
export function ActionButton({
  action,
  children,
  onDone,
  className = "button",
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  onDone?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <>
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await action();
            onDone?.();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "处理中…" : children}
      </button>
      <ErrorMessage error={error} />
    </>
  );
}

export function FloatingAction({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const header = useContext(MobileHeaderContext);
  const button = (
    <button className="create-fab" aria-label={label} onClick={onClick} disabled={disabled}>
      <CanonicalIcon name="plus" size={27} />
      <span className="sr-only">{label}</span>
    </button>
  );
  return header?.fab ? createPortal(button, header.fab) : button;
}
