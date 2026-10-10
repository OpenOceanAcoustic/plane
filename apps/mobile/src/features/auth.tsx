import { useState, type ReactNode } from "react";
import { CanonicalIcon } from "../components/navigation";
// eslint-disable-next-line import/no-unassigned-import
import "./auth.css";
import { ApiClient, normalizeServer } from "../lib/client";
import { ErrorMessage, type Entity } from "../components/ui";

export function ServerSetup({ initial, onConnect }: { initial: string; onConnect: (server: string) => Promise<void> }) {
  const [server, setServer] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <AuthFrame title="连接服务器">
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
    </AuthFrame>
  );
}
export function Login({
  client,
  onLogin,
  onServerChange,
  onSpace,
}: {
  client: ApiClient;
  onLogin: () => Promise<void>;
  onServerChange: () => void;
  onSpace: () => void;
}) {
  const [mode, setMode] = useState<"login" | "enroll">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<Entity | null>(null);
  const [completed, setCompleted] = useState(false);
  const returnToLogin = () => {
    setMode("login");
    setPending(null);
    setCompleted(false);
    setError(undefined);
  };
  return (
    <AuthFrame
      title={completed ? "绑定完成" : mode === "login" ? "登录实验室" : pending ? "绑定 Authenticator" : "加入实验室"}
      onBack={mode === "enroll" || completed ? returnToLogin : undefined}
    >
      {(mode === "enroll" || completed) && <AuthSteps step={completed ? 2 : pending ? 1 : 0} />}
      {completed ? (
        <>
          <p className="auth-success">
            <CanonicalIcon name="check" size={18} />
            绑定成功。请等待下一动态码，然后返回登录。
          </p>
          <button className="button primary" onClick={returnToLogin}>
            返回登录
          </button>
        </>
      ) : (
        <>
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
                  setCompleted(true);
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
                <span>
                  邀请 / 重绑口令 <em>*</em>
                </span>
                <input required name="token" type="password" autoComplete="off" />
              </label>
            )}
            {!pending && (
              <label className="field">
                <span>
                  用户名 <em>*</em>
                </span>
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
                <div className="auth-qr">
                  <img className="totp-qr" src={String(pending.qr)} alt="验证器绑定二维码" />
                  <span>使用验证器扫描二维码</span>
                </div>
                <a className="button" href={String(pending.otpauth)}>
                  打开验证器
                </a>
              </>
            )}
            {(mode === "login" || pending) && (
              <label className="field">
                <span>
                  六位动态码 <em>*</em>
                </span>
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
        </>
      )}
      <div className="auth-options">
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "login" ? "enroll" : "login");
            setCompleted(false);
            setPending(null);
            setError(undefined);
          }}
        >
          {mode === "login" ? "邀请绑定 / 重新绑定" : "返回登录"}
        </button>
        <button className="text-button" onClick={onServerChange}>
          服务器设置
        </button>
        <button className="text-button" onClick={onSpace}>
          打开共享页面
        </button>
      </div>
    </AuthFrame>
  );
}

function AuthFrame({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  return (
    <main className="auth-page mobile-auth">
      <header className="auth-masthead">
        {onBack && (
          <button className="icon-button" aria-label="返回" onClick={onBack}>
            <CanonicalIcon name="back" size={20} />
          </button>
        )}
        <div className="auth-wordmark">
          <span className="auth-symbol">
            <CanonicalIcon name="wave" size={25} />
          </span>
          <span>OpenOceanAcoustic</span>
        </div>
      </header>
      <div className="auth-content">
        <div className="auth-intro">
          <h1>{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
function AuthSteps({ step }: { step: number }) {
  return (
    <div className="auth-stepper" aria-label="绑定进度">
      {["填写资料", "绑定", "完成"].map((label, index) => (
        <div className={`auth-step ${step === index ? "active" : ""}`} key={label}>
          <span>{index + 1}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}
