/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { defineConfig } from "@playwright/test";
const port = Number(process.env.LAB_BROWSER_PORT ?? "3105");
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL,
    browserName: "chromium",
    launchOptions: { executablePath: process.env.LAB_BROWSER_EXECUTABLE },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node serve.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
