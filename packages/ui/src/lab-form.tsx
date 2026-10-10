/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * Dialog and Select composition adapted from shadcn/ui (MIT):
 * https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/ui
 * Copyright (c) 2023 shadcn. License retained in docs/lab/THIRD_PARTY_NOTICES.md.
 */

import { cloneElement, isValidElement, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "./button";

export const labInputClass =
  "w-full rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:border-accent-strong disabled:cursor-not-allowed disabled:opacity-50";

export function LabField({ label, children }: { label: string; children: ReactNode }) {
  const control =
    isValidElement<{ "aria-label"?: string; "aria-labelledby"?: string }>(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) &&
    !children.props["aria-label"] &&
    !children.props["aria-labelledby"]
      ? cloneElement(children, { "aria-label": label })
      : children;
  return (
    <label className="flex flex-col gap-1.5 text-13 text-secondary">
      {label}
      {control}
    </label>
  );
}

export function LabSelect({
  label,
  value,
  options,
  onValueChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className="focus-visible:ring-accent-primary flex min-w-36 items-center justify-between gap-3 rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus-visible:ring-2 disabled:opacity-50"
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={14} className="text-tertiary" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="shadow-md z-[100] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-md border border-subtle bg-surface-1 p-1 text-primary"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer items-center rounded px-7 py-2 text-13 outline-none data-[highlighted]:bg-layer-1"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2">
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function LabDialog({
  title,
  children,
  onClose,
  onSubmit,
  busy,
  submitLabel = "保存",
  description,
  error,
  destructive = false,
  submitDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: (data: FormData) => Promise<void>;
  busy: boolean;
  submitLabel?: string;
  description?: string;
  error?: string;
  destructive?: boolean;
  submitDisabled?: boolean;
}) {
  const id = useId();
  const [localError, setLocalError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSubmit || busy || submitDisabled) return;
    const data = new FormData(event.currentTarget);
    setLocalError("");
    try {
      await onSubmit(data);
    } catch (failure) {
      setLocalError(failure instanceof Error ? failure.message : "操作失败，请重试");
    }
  }
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          aria-modal="true"
          aria-describedby={description ? `${id}-description` : undefined}
          className="shadow-xl fixed top-1/2 left-1/2 z-[81] max-h-[85vh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-subtle bg-surface-1 p-6 text-primary"
        >
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogPrimitive.Title className="pr-7 text-18 font-semibold">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description id={`${id}-description`} className="text-13 text-secondary">
                {description}
              </DialogPrimitive.Description>
            )}
            {children}
            {(error || localError) && (
              <p
                role="alert"
                className="rounded border border-danger-subtle bg-danger-subtle/10 p-3 text-13 text-danger-primary"
              >
                {error || localError}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2 border-t border-subtle pt-4">
              <Button variant="neutral-primary" disabled={busy} onClick={onClose}>
                {onSubmit ? "取消" : "关闭"}
              </Button>
              {onSubmit && (
                <Button
                  type="submit"
                  loading={busy}
                  disabled={submitDisabled}
                  variant={destructive ? "danger" : "primary"}
                >
                  {submitLabel}
                </Button>
              )}
            </div>
          </form>
          <DialogPrimitive.Close
            aria-label="关闭弹窗"
            disabled={busy}
            className="focus-visible:ring-accent-primary absolute top-4 right-4 rounded p-1 text-secondary hover:bg-layer-1 focus-visible:ring-2"
          >
            <X size={16} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
