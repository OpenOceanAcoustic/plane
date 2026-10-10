/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Dialog } from "@headlessui/react";
import { Button } from "./button";
import { ModalCore } from "./modals/modal-core";

type Browser = {
  id: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  current: boolean;
};
type BrowserService = {
  getBrowsers: () => Promise<Browser[]>;
  revokeBrowser: (id: string) => Promise<void>;
  forgetBrowser: () => Promise<void>;
};
const message = (error: unknown) => {
  if (error && typeof error === "object" && "response" in error) {
    const response = error.response as { data?: { error?: string; retry_after?: number } } | undefined;
    if (response?.data?.error) return response.data.error;
  }
  return error instanceof Error ? error.message : "请求失败，请重试";
};

export function LabBrowserSettings({
  service,
  onSessionRevoked,
}: {
  service: BrowserService;
  onSessionRevoked?: () => void;
}) {
  const [browsers, setBrowsers] = useState<Browser[]>();
  const [errorMessage, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void service
      .getBrowsers()
      .then((value) => {
        if (mounted) setBrowsers(value);
        return value;
      })
      .catch((error) => {
        if (mounted) setError(message(error));
      });
    return () => {
      mounted = false;
    };
  }, [service]);
  async function revoke(browser?: Browser) {
    setBusy(true);
    setError("");
    try {
      if (browser) await service.revokeBrowser(browser.id);
      else await service.forgetBrowser();
      if (!browser || browser.current) {
        onSessionRevoked?.();
        return;
      }
      setBrowsers(await service.getBrowsers());
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 text-primary">
      <h2 className="text-18 font-semibold">可信浏览器</h2>
      {errorMessage && (
        <p role="alert" className="text-danger-primary">
          {errorMessage}
        </p>
      )}
      {!browsers && !errorMessage && <p>加载中…</p>}
      {browsers?.length === 0 && <p className="text-secondary">暂无可信浏览器</p>}
      {browsers?.map((browser) => (
        <div key={browser.id} className="flex items-center justify-between gap-4 rounded border border-subtle p-3">
          <div>
            <p>
              {browser.name}
              {browser.current ? "（当前浏览器）" : ""}
            </p>
            <p className="text-13 text-secondary">到期：{new Date(browser.expires_at).toLocaleString()}</p>
          </div>
          <Button variant="outline-primary" disabled={busy} onClick={() => void revoke(browser)}>
            撤销
          </Button>
        </div>
      ))}
      <Button variant="outline-primary" disabled={busy} onClick={() => void revoke()}>
        忘记当前浏览器并退出
      </Button>
    </section>
  );
}

type ReauthRequest = { resolve: () => void; reject: (reason: Error) => void };
export function LabAdminReauthDialog({ onVerify }: { onVerify: (code: string) => Promise<void> }) {
  const pending = useRef<ReauthRequest | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [errorMessage, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => {
      const request = (event as CustomEvent<ReauthRequest>).detail;
      if (pending.current) {
        request.reject(new Error("正在重新验证"));
        return;
      }
      pending.current = request;
      setCode("");
      setError("");
      setOpen(true);
    };
    window.addEventListener("lab-admin-reauthenticate", handler);
    return () => {
      window.removeEventListener("lab-admin-reauthenticate", handler);
      pending.current?.reject(new Error("重新验证已取消"));
      pending.current = undefined;
    };
  }, []);
  function cancel() {
    if (busy) return;
    pending.current?.reject(new Error("重新验证已取消"));
    pending.current = undefined;
    setOpen(false);
    setCode("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onVerify(code);
      pending.current?.resolve();
      pending.current = undefined;
      setOpen(false);
      setCode("");
    } catch (error) {
      setError(message(error));
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalCore isOpen={open} handleClose={cancel}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4 p-6">
        <Dialog.Title className="text-18 font-semibold">管理员重新验证</Dialog.Title>
        <label className="block">
          动态码
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="mt-2 block w-full rounded border border-subtle bg-surface-1 p-2"
          />
        </label>
        {errorMessage && (
          <p role="alert" className="text-danger-primary">
            {errorMessage}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline-primary" disabled={busy} onClick={cancel}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            验证
          </Button>
        </div>
      </form>
    </ModalCore>
  );
}
