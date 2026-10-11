import { useEffect, useRef, type ReactNode } from "react";
import { dialogFocusTargets, isTopDialog } from "../lib/dialog";
import { CanonicalIcon } from "./navigation";

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
    const dialog = ref.current;
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
        const targets = dialogFocusTargets(ref.current);
        if (!targets?.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        const active = document.activeElement;
        const atContainer = active === ref.current || !ref.current?.contains(active);
        if (event.shiftKey && (active === first || atContainer)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || atContainer)) {
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
      const active = document.activeElement;
      // Commands such as paragraph formatting deliberately focus the editor.
      // Restore only when closing the panel has not moved focus elsewhere.
      if (previous?.isConnected && (!active || active === document.body || dialog?.contains(active))) previous.focus();
    };
  }, []);
  return (
    <div className="overlay">
      <button type="button" tabIndex={-1} className="scrim" onClick={onClose} disabled={busy} aria-label="关闭面板" />
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="handle" />
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose} disabled={busy}>
            <CanonicalIcon name="close" size={22} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
