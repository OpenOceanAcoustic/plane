/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as dotenv from "dotenv";
import { z } from "zod";
import { isIP } from "node:net";

dotenv.config();

// Environment variable validation
const envSchema = z.object({
  PUBLIC_ORIGIN: z.string().default(""),
  WEB_BASE_URL: z.string().default(""),
  PUBLIC_DEPLOYMENT: z.string().default("0"),
  TRUSTED_PROXY_CIDRS: z.string().default(""),
  LIVE_HANDSHAKE_SOURCE_LIMIT: z.coerce.number().int().positive().default(60),
  LIVE_HANDSHAKE_GLOBAL_LIMIT: z.coerce.number().int().positive().default(240),
  APP_VERSION: z.string().default("1.0.0"),
  HOSTNAME: z.string().optional(),
  PORT: z.string().default("3000"),
  API_BASE_URL: z.string().url("API_BASE_URL must be a valid URL"),
  // CORS configuration
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  // Live running location
  LIVE_BASE_PATH: z.string().default("/live"),
  // Compression options
  COMPRESSION_LEVEL: z.string().default("6").transform(Number),
  COMPRESSION_THRESHOLD: z.string().default("5000").transform(Number),
  // secret
  LIVE_SERVER_SECRET_KEY: z.string(),
  // Redis configuration
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().default("6379").transform(Number),
  REDIS_URL: z.string().optional(),
});

const validateEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:", JSON.stringify(result.error.format(), null, 4));
    process.exit(1);
  }
  const origin = result.data.PUBLIC_ORIGIN || result.data.WEB_BASE_URL;
  if (
    !origin ||
    new URL(origin).origin !== origin ||
    (result.data.PUBLIC_DEPLOYMENT === "1" && !origin.startsWith("https://"))
  ) {
    throw new Error("A canonical PUBLIC_ORIGIN is required (HTTPS for public deployments)");
  }
  const proxies = result.data.TRUSTED_PROXY_CIDRS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    (result.data.PUBLIC_DEPLOYMENT === "1" && !proxies.length) ||
    proxies.some((value) => {
      const [address, prefix] = value.split("/");
      return !address || !isIP(address) || Number(prefix) !== (isIP(address) === 4 ? 32 : 128);
    })
  )
    throw new Error("Live trusts only explicit proxy addresses (/32 or /128)");
  return result.data;
};

export const env = validateEnv();
