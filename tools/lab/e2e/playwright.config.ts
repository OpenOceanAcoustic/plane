/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { defineConfig } from "@playwright/test";
// The pinned Playwright version otherwise records the binding URI and code in
// an accessibility snapshot on failure, even when tracing/screenshots are off.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 360000,
  use: {
    baseURL: process.env.LAB_E2E_BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1920, height: 1080 },
    browserName: "chromium",
    actionTimeout: 30000,
    navigationTimeout: 30000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
