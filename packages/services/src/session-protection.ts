/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { create, AxiosHeaders } from "axios";
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

type ProtectedConfig = InternalAxiosRequestConfig & { csrfRetried?: boolean; reauthRetried?: boolean };
type Challenge = { token?: string; pending?: Promise<string> };
const challenges = new Map<string, Challenge>();
let reauthentication: Promise<void> | undefined;
let listening = false;

export function requestAdminReauthentication(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("需要重新验证"));
  if (!reauthentication) {
    reauthentication = new Promise<void>((resolve, reject) => {
      window.dispatchEvent(new CustomEvent("lab-admin-reauthenticate", { detail: { resolve, reject } }));
    }).finally(() => {
      reauthentication = undefined;
    });
  }
  return reauthentication;
}

/** Both browser API bases share a challenge per controlled API origin. */
export function installSessionProtection(client: AxiosInstance, baseURL: string): void {
  const browserOrigin = typeof window === "undefined" ? undefined : window.location.origin;
  let origin: string;
  try {
    origin = new URL(baseURL || "/", browserOrigin).origin;
  } catch {
    return;
  }
  const state = challenges.get(origin) ?? {};
  challenges.set(origin, state);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("lab-session-changed", () => {
      for (const challenge of challenges.values()) {
        challenge.token = undefined;
        challenge.pending = undefined;
      }
    });
  }
  const controlled = (config: InternalAxiosRequestConfig) => {
    try {
      return new URL(config.url ?? "", new URL(config.baseURL || baseURL || "/", browserOrigin)).origin === origin;
    } catch {
      return false;
    }
  };
  const challenge = async () => {
    if (state.token) return state.token;
    if (!state.pending) {
      const transport = create({ withCredentials: true });
      state.pending = transport
        .get<{ csrf_token: string }>(`${origin}/auth/get-csrf-token/`)
        .then((response) => {
          state.token = response.data.csrf_token;
          return state.token;
        })
        .finally(() => {
          state.pending = undefined;
        });
    }
    return state.pending;
  };
  client.interceptors.request.use(async (config) => {
    if (controlled(config) && !["get", "head", "options"].includes(config.method?.toLowerCase() ?? "get")) {
      config.headers = AxiosHeaders.from(config.headers);
      config.headers.set("X-CSRFToken", await challenge());
    }
    return config;
  });
  client.interceptors.response.use(
    (response) => {
      if (
        controlled(response.config) &&
        /\/auth\/(?:lab\/)?(?:admin\/)?(?:sign-in|sign-out|confirm)\//.test(response.config.url ?? "")
      ) {
        state.token = undefined;
      }
      return response;
    },
    async (error: AxiosError<{ code?: string; error_code?: string }>) => {
      const config = error.config as ProtectedConfig | undefined;
      if (!config || !controlled(config)) throw error;
      const code = error.response?.data?.code ?? error.response?.data?.error_code;
      if (error.response?.status === 403 && code === "CSRF_FAILED" && !config.csrfRetried) {
        config.csrfRetried = true;
        state.token = undefined;
        await challenge();
        return client.request(config);
      }
      if (error.response?.status === 403 && code === "ADMIN_REAUTH_REQUIRED" && !config.reauthRetried) {
        config.reauthRetried = true;
        await requestAdminReauthentication();
        return client.request(config);
      }
      throw error;
    }
  );
}
