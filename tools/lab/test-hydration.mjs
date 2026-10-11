// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Read-only check of the production SPA shell; no accounts or invitations are created.
const origin = process.env.LAB_HYDRATION_BASE_URL ?? "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.LAB_BROWSER_EXECUTABLE,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  await Promise.all(
    ["light", "dark", "system"].map(async (theme) => {
      const context = await browser.newContext();
      await context.addInitScript((value) => localStorage.setItem("theme", value), theme);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.getByLabel("用户名", { exact: true }).waitFor();
      assert.deepEqual(errors, [], `${theme}: initial page rendering failed`);
      console.log(`${theme}: login page hydrated without errors`);
      await context.close();
    })
  );
} finally {
  await browser.close();
}
