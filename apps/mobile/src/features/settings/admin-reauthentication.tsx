import { useEffect, useRef, useState } from "react";
import { ErrorMessage, Sheet } from "../../components/ui";
import { ApiClient, ApiError, type AdminReauthenticationChallenge } from "../../lib/client";

type Challenge = AdminReauthenticationChallenge & {
  resolve: () => void;
  reject: (error: ApiError) => void;
};

export function AdminReauthentication({ client }: { client: ApiClient }) {
  const [challenge, setChallenge] = useState<Challenge>();
  const current = useRef<Challenge>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const cancel = () => {
    current.current?.reject(new ApiError(403, { code: "ADMIN_REAUTH_REQUIRED", error: "已取消动态码验证" }));
    current.current = undefined;
    setChallenge(undefined);
    setCode("");
    setError(undefined);
  };
  useEffect(() => {
    const required = (context: AdminReauthenticationChallenge) =>
      new Promise<void>((resolve, reject) => {
        const next = { ...context, resolve, reject };
        current.current = next;
        setCode("");
        setError(undefined);
        setChallenge(next);
      });
    client.onAdminReauthenticationRequired = required;
    return () => {
      if (client.onAdminReauthenticationRequired === required) client.onAdminReauthenticationRequired = undefined;
      current.current?.reject(new ApiError(403, { code: "ADMIN_REAUTH_REQUIRED", error: "已取消动态码验证" }));
      current.current = undefined;
    };
  }, [client]);
  if (!challenge) return null;
  return (
    <Sheet title="验证管理员身份" onClose={cancel} busy={busy}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || current.current !== challenge) return;
          if (!challenge.isCurrent()) {
            challenge.reject(new ApiError(409, { error: "服务器已切换，请重新打开表单" }));
            current.current = undefined;
            setChallenge(undefined);
            return;
          }
          setBusy(true);
          setError(undefined);
          try {
            await client.request("/auth/lab/admin/reauthenticate/", "POST", { code });
            if (current.current !== challenge) return;
            challenge.resolve();
            current.current = undefined;
            setChallenge(undefined);
            setCode("");
          } catch (failure) {
            if (current.current === challenge) {
              const failureCode =
                failure instanceof ApiError && typeof failure.data === "object" && failure.data !== null
                  ? (failure.data as Record<string, unknown>).code
                  : undefined;
              if (failure instanceof ApiError && failure.status === 401 && failureCode !== "INVALID_CREDENTIALS") {
                challenge.reject(failure);
                current.current = undefined;
                setChallenge(undefined);
              } else {
                setError(failure);
                setCode("");
              }
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>六位动态码</span>
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <ErrorMessage error={error} />
        <div className="actions">
          <button className="button" type="button" disabled={busy} onClick={cancel}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "验证中…" : "验证"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
