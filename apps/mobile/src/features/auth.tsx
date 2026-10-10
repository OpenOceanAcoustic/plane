import { useState } from "react";
import { ChevronLeft, Radio } from "lucide-react";
import { ApiClient, normalizeServer } from "../lib/client";
import { ErrorMessage, type Entity } from "../components/ui";

export function ServerSetup({ initial, onConnect }: { initial: string; onConnect: (server: string) => Promise<void> }) {
  const [server, setServer] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <main className="auth-page">
      <div className="app-mark">
        <Radio />
      </div>
      <h1>OpenOceanAcoustic</h1>
      <h2>连接服务器</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            const root = normalizeServer(server);
            const candidate = new ApiClient(root);
            const instance = await candidate.request<{ mobile_api_version?: number }>("/api/instances/");
            if (instance.mobile_api_version !== 1) throw new Error("服务器尚未安装移动端接口，请更新后端后重试");
            await onConnect(root);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>服务器地址</span>
          <input
            type="url"
            required
            placeholder="https://plane.example.org"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <ErrorMessage error={error} />
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "检查连接…" : "连接"}
        </button>
      </form>
    </main>
  );
}
export function Login({
  client,
  onLogin,
  onServerChange,
  onAdmin,
  onSpace,
}: {
  client: ApiClient;
  onLogin: () => Promise<void>;
  onServerChange: () => void;
  onAdmin: () => void;
  onSpace: () => void;
}) {
  const [mode, setMode] = useState<"login" | "enroll">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<Entity | null>(null);
  return (
    <main className="auth-page">
      <button className="icon-button auth-back" aria-label="服务器设置" onClick={onServerChange}>
        <ChevronLeft />
      </button>
      <div className="app-mark">
        <Radio />
      </div>
      <h1>OpenOceanAcoustic</h1>
      <h2>{mode === "login" ? "登录工作区" : pending ? "绑定验证器" : "邀请绑定 / 重新绑定"}</h2>
      <form
        key={`${mode}-${Boolean(pending)}`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const data = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          setError(undefined);
          try {
            if (mode === "login") {
              await client.request("/auth/lab/mobile/sign-in/", "POST", data);
              await client.refreshCsrf();
              await onLogin();
            } else if (!pending) setPending(await client.request<Entity>("/auth/lab/enroll/", "POST", data));
            else {
              await client.request("/auth/lab/confirm/", "POST", { token: pending.token, code: data.code });
              setPending(null);
              setMode("login");
            }
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === "enroll" && !pending && (
          <label className="field">
            <span>邀请 / 重绑口令</span>
            <input required name="token" type="password" autoComplete="off" />
          </label>
        )}
        {!pending && (
          <label className="field">
            <span>用户名</span>
            <input required name="username" autoCapitalize="none" autoComplete="username" />
          </label>
        )}
        {mode === "enroll" && !pending && (
          <>
            <label className="field">
              <span>显示姓名</span>
              <input name="display_name" />
            </label>
            <label className="field">
              <span>联系邮箱</span>
              <input name="email" type="email" />
            </label>
          </>
        )}
        {pending && (
          <>
            <img className="totp-qr" src={String(pending.qr)} alt="验证器绑定二维码" />
            <a className="button" href={String(pending.otpauth)}>
              打开验证器
            </a>
          </>
        )}
        {(mode === "login" || pending) && (
          <label className="field">
            <span>六位动态码</span>
            <input
              required
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
            />
          </label>
        )}
        <ErrorMessage error={error} />
        <button className="button primary" disabled={busy} type="submit">
          {busy ? "处理中…" : mode === "login" ? "登录" : pending ? "确认绑定" : "开始绑定"}
        </button>
      </form>
      <div className="auth-options">
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "login" ? "enroll" : "login");
            setPending(null);
            setError(undefined);
          }}
        >
          {mode === "login" ? "邀请绑定 / 重新绑定" : "返回登录"}
        </button>
        <button className="text-button" onClick={onAdmin}>
          God Mode
        </button>
        <button className="text-button" onClick={onSpace}>
          打开共享页面
        </button>
      </div>
    </main>
  );
}
