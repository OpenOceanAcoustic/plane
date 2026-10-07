/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@plane/ui";

export const labInputClass =
  "w-full rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:border-accent-strong";

export function LabField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-13 text-secondary">
      {label}
      {children}
    </label>
  );
}

export function LabDialog({
  title,
  children,
  onClose,
  onSubmit,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<void>;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(new FormData(event.currentTarget));
  }
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      className="shadow-lg m-auto w-full max-w-lg rounded-lg border border-subtle bg-surface-1 p-6 text-primary backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="text-18 font-semibold">{title}</h2>
        {children}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="neutral-primary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            保存
          </Button>
        </div>
      </form>
    </dialog>
  );
}
