import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { ChevronLeft, X } from "lucide-react";
import sanitizeHtml from "sanitize-html";
import type { ApiClient } from "../lib/client";
import { MobileClientContext, RichHtmlEditor, resolveImage } from "./rich-editor";

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
export function PageHeading({ title, children, onBack }: { title: string; children?: ReactNode; onBack?: () => void }) {
  return (
    <div className="page-heading">
      {onBack && (
        <button className="icon-button" onClick={onBack} aria-label="返回">
          <ChevronLeft />
        </button>
      )}
      <h1>{title}</h1>
      <div className="heading-actions">{children}</div>
    </div>
  );
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
              {textValue(item.name ?? item.title ?? item.display_name ?? item.id)}
            </button>
          ) : (
            <h3>{textValue(item.name ?? item.title ?? item.display_name ?? item.id)}</h3>
          )}
          <dl className="record-fields">
            {(fields ?? Object.keys(item).filter((k) => !["id", "name", "title", "description_html"].includes(k))).map(
              (key) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{textValue(item[key])}</dd>
                </div>
              )
            )}
          </dl>
        </article>
      ))}
    </div>
  );
}
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const close = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
    window.addEventListener("mobileBack", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mobileBack", close);
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="overlay">
      <button className="scrim" onClick={onClose} aria-label="关闭面板" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="handle" />
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X />
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
    <Sheet title={title} onClose={onClose}>
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
