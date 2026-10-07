/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180000,
  use: {
    baseURL: "http://localhost:8080",
    viewport: { width: 1920, height: 1080 },
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
