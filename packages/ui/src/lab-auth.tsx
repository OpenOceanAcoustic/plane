/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "./button";

type Enrollment = { token: string; qr: string; otpauth: string; username: string; rebind: boolean };

/** Shared by app, God Mode and Space so the invitation policy has one UI. */
export function LabAuth({
  apiBase = "",
  admin = false,
  register = false,
  invitationToken = "",
  onSuccess,
}: {
  apiBase?: string;
  admin?: boolean;
  register?: boolean;
  invitationToken?: string;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [rememberBrowser, setRememberBrowser] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState(invitationToken);

  async function post(path: string, data: Record<string, string | boolean>) {
    const csrfResponse = await fetch(`${apiBase}/auth/get-csrf-token/`, { credentials: "include" });
    const csrf = (await csrfResponse.json()) as { csrf_token: string };
    const response = await fetch(`${apiBase}/auth/lab/${path}/`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf.csrf_token },
      body: JSON.stringify(data),
    });
    const result = (await response.json()) as Enrollment & { error?: string; message?: string; retry_after?: number };
    if (!response.ok) {
      const error = result.error ?? "暂时无法连接服务器";
      throw new Error(result.retry_after ? `${error}，请在 ${result.retry_after} 秒后重试` : error);
    }
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (register && !enrollment) {
        const result = await post("enroll", { token: invitation, username, display_name: name, email });
        setEnrollment(result);
        setCode("");
      } else if (enrollment) {
        await post("confirm", { token: enrollment.token, code });
        window.dispatchEvent(new Event("lab-session-changed"));
        setEnrollment(undefined);
        setInvitation("");
        setCode("");
        setMessage("绑定成功。请等待下一动态码，然后返回登录。");
        onSuccess();
      } else {
        await post(admin ? "admin/sign-in" : "sign-in", { username, code, remember_browser: rememberBrowser });
        window.dispatchEvent(new Event("lab-session-changed"));
        onSuccess();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请求失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:border-accent-strong";
  const bindingDone = register && !invitation;
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-lg border border-subtle bg-surface-1 p-8 text-primary">
      <div>
        <h1 className="text-20 font-semibold">
          {register ? "加入 OpenOceanAcoustic" : admin ? "实验室管理后台" : "登录 OpenOceanAcoustic"}
        </h1>
      </div>
      {message && (
        <p role="status" className="rounded-md bg-layer-1 p-3 text-13">
          {message}
        </p>
      )}
      {!bindingDone && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!enrollment && (
            <label className="text-13">
              用户名
              <input
                className={inputClass}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required={!register}
                maxLength={64}
              />
            </label>
          )}
          {register && !enrollment && (
            <>
              <label className="text-13">
                显示姓名
                <input
                  className={inputClass}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={255}
                />
              </label>
              <label className="text-13">
                联系邮箱
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
            </>
          )}
          {enrollment && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-13">使用 Authenticator 扫码绑定 {enrollment.username}</p>
              <img
                src={enrollment.qr}
                alt="Authenticator 绑定二维码"
                width={220}
                height={220}
                className="rounded bg-white p-2"
                referrerPolicy="no-referrer"
              />
              <details className="w-full text-12">
                <summary>无法扫码？查看本地绑定地址</summary>
                <p className="p-2 break-all select-all">{enrollment.otpauth}</p>
              </details>
            </div>
          )}
          {(!register || enrollment) && (
            <label className="text-13">
              六位动态码
              <input
                className={inputClass}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
              />
            </label>
          )}
          {!register && (
            <label className="flex items-center gap-2 text-13">
              <input
                type="checkbox"
                checked={rememberBrowser}
                onChange={(event) => setRememberBrowser(event.target.checked)}
              />
              记住此浏览器
            </label>
          )}
          <Button type="submit" loading={busy}>
            {enrollment ? "确认绑定" : register ? "开始绑定" : "登录"}
          </Button>
        </form>
      )}
      {register && (
        <a href="/" className="text-13 text-accent-primary">
          返回登录
        </a>
      )}
    </section>
  );
}
