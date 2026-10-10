/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosInstance } from "axios";
import { create } from "axios";
import { env } from "@/env";
import { AppError } from "@/lib/errors";

export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;
  private header: Record<string, string> = {};
  private csrf: Promise<{ cookie: string; token: string }> | undefined;
  private csrfCookie: string | undefined;

  constructor(baseURL?: string) {
    this.baseURL = baseURL || env.API_BASE_URL;
    this.axiosInstance = create({
      baseURL: this.baseURL,
      withCredentials: true,
      timeout: 20000,
    });
    this.setupInterceptors();
  }

  private setupInterceptors() {
    // oxlint-disable-next-line oxc/no-async-endpoint-handlers -- Axios awaits interceptor promises; this is not an Express handler.
    this.axiosInstance.interceptors.request.use(async (request) => {
      if (["get", "head", "options"].includes((request.method ?? "get").toLowerCase())) return request;
      const cookie = request.headers.get("Cookie")?.toString() || this.header.Cookie;
      const origin = env.PUBLIC_ORIGIN || env.WEB_BASE_URL;
      if (!cookie || !origin) throw new AppError("Session and canonical Origin required for writes");
      if (this.csrfCookie !== cookie) {
        this.csrf = undefined;
        this.csrfCookie = cookie;
      }
      this.csrf ??= this.axiosInstance
        .get("/auth/get-csrf-token/", { headers: { Cookie: cookie, Origin: origin } })
        .then((response) => {
          const token = response.data.csrf_token;
          if (typeof token !== "string" || !token) throw new AppError("CSRF token unavailable");
          const cookies = new Map(
            cookie.split(";").map((part) => {
              const [key, ...value] = part.trim().split("=");
              return [key!, value.join("=")] as const;
            })
          );
          for (const item of response.headers["set-cookie"] ?? []) {
            const [pair] = item.split(";");
            const [key, ...value] = pair!.split("=");
            cookies.set(key!, value.join("="));
          }
          return { token, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") };
        })
        .catch((error) => {
          this.csrf = undefined;
          throw error;
        });
      const csrf = await this.csrf;
      request.headers.set("Cookie", csrf.cookie);
      request.headers.set("X-CSRFToken", csrf.token);
      request.headers.set("Origin", origin);
      return request;
    });
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        return Promise.reject(new AppError(error));
      }
    );
  }

  setHeader(key: string, value: string) {
    if (key.toLowerCase() === "cookie") this.csrf = undefined;
    this.header[key] = value;
  }

  getHeader() {
    return this.header;
  }

  get(url: string, params = {}, config = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: Record<string, unknown> | null | string, config = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}
