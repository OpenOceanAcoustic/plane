/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useRef, useState, Children, cloneElement, isValidElement } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
export { LabAmountInput, labAmountError, labDecimalText, labDecimalUnits } from "./amount";
const dialogStack: string[] = [];
export const labInputClass = "lab-input";
export function Button({
  size: _size,
  variant,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) {
  return (
    <button type="button" className={`lab-button ${variant === "primary" ? "primary" : ""} ${className}`} {...props} />
  );
}
export function LabField({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="lab-field">
      <label htmlFor={id}>{label}</label>
      {Children.map(children, (child) =>
        isValidElement<{ id?: string; "aria-label"?: string }>(child)
          ? cloneElement(child, { id, "aria-label": child.props["aria-label"] ?? label })
          : child
      )}
    </div>
  );
}
export function LabDialog({
  title,
  children,
  onClose,
  onSubmit,
  busy,
  submitDisabled,
  error,
  submitLabel = "保存",
  destructive = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: (data: FormData) => Promise<unknown> | unknown;
  busy?: boolean;
  submitDisabled?: boolean;
  error?: string;
  submitLabel?: string;
  destructive?: boolean;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const callbacks = useRef({ onClose, busy, saving });
  callbacks.current = { onClose, busy, saving };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogStack.push(id);
    const targets = () =>
      form.current
        ?.closest(".lab-sheet")
        ?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]"
        );
    targets()?.[0]?.focus();
    const close = (event: Event) => {
      if (dialogStack.at(-1) !== id || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!callbacks.current.busy && !callbacks.current.saving) callbacks.current.onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== id) return;
      if (event.key === "Escape") close(event);
      if (event.key === "Tab") {
        const list = targets();
        if (!list?.length) return;
        const first = list[0]!,
          last = list[list.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    window.addEventListener("mobileBack", close, true);
    return () => {
      const index = dialogStack.indexOf(id);
      if (index >= 0) dialogStack.splice(index, 1);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("mobileBack", close, true);
      previous?.focus();
    };
  }, [id]);
  return (
    <div className="lab-overlay">
      <button
        type="button"
        tabIndex={-1}
        className="lab-scrim"
        aria-label="关闭面板"
        disabled={saving || busy}
        onClick={onClose}
      />
      <section className="lab-sheet" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="lab-sheet-title">
          <h2 id={id}>{title}</h2>
          <button aria-label="关闭" type="button" className="lab-button" disabled={busy || saving} onClick={onClose}>
            关闭
          </button>
        </div>
        <form
          ref={form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!onSubmit || saving || busy || submitDisabled) return;
            setSaving(true);
            setFailure("");
            try {
              await onSubmit(new FormData(event.currentTarget));
            } catch (e) {
              setFailure(e instanceof Error ? e.message : "操作失败");
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="lab-form-body">
            {children}
            {(error || failure) && (
              <p role="alert" className="lab-error">
                {error || failure}
              </p>
            )}
          </div>
          {onSubmit && (
            <footer>
              <button
                className={`lab-button ${destructive ? "danger" : "primary"}`}
                disabled={busy || saving || submitDisabled}
              >
                {busy || saving ? "正在保存…" : submitLabel}
              </button>
            </footer>
          )}
        </form>
      </section>
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="lab-error">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
export function Empty({ children = "暂无记录" }: { children?: ReactNode }) {
  return <p className="lab-empty">{children}</p>;
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="lab-tabs" role="tablist">
      {items.map((row) => (
        <button
          type="button"
          key={row.id}
          role="tab"
          aria-selected={value === row.id}
          className={value === row.id ? "active" : ""}
          onClick={() => onChange(row.id)}
        >
          {row.name}
        </button>
      ))}
    </div>
  );
}
export function KeyValues({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="lab-values">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {value === null || value === undefined ? (
              "—"
            ) : typeof value === "object" ? (
              <pre>{JSON.stringify(value, null, 2)}</pre>
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
