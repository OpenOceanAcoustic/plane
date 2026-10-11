import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sheet } from "./sheet";

type ConfirmationOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/** One cancellable confirmation at a time, owned by the mounted caller. */
export function useMobileConfirmation() {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const mounted = useRef(false);
  const pending = useRef<((accepted: boolean) => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const resolve = pending.current;
      pending.current = null;
      resolve?.(false);
    };
  }, []);

  const settle = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    if (mounted.current) setOptions(null);
    resolve?.(accepted && mounted.current);
  }, []);

  const ask = useCallback((next: ConfirmationOptions): Promise<boolean> => {
    if (!mounted.current || pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setOptions(next);
    });
  }, []);

  const confirmation = options
    ? createPortal(
        <Sheet title={options.title} onClose={() => settle(false)} className="mobile-confirm-sheet">
          <p className="mobile-confirm-message">{options.message}</p>
          <div className="mobile-confirm-actions">
            <button type="button" className="button mobile-confirm-cancel" onClick={() => settle(false)}>
              {options.cancelLabel ?? "取消"}
            </button>
            <button
              type="button"
              className={`button primary mobile-confirm-accept${options.destructive ? " is-destructive" : ""}`}
              onClick={() => settle(true)}
            >
              {options.confirmLabel ?? "确认"}
            </button>
          </div>
        </Sheet>,
        document.body
      )
    : null;

  return { ask, confirmation };
}
