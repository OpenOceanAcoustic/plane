/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
let server: ReturnType<typeof createServer>;
let origin = "";
let directory = "";
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "session-security-ui-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { LabBrowserSettings, LabAdminReauthDialog } from '${resolve("packages/ui/src/lab-session-security.tsx")}'; let devices = [{id:'other', name:'工作电脑', created_at:'2026-10-10',expires_at:'2026-11-09', last_used_at:'2026-10-10',current:false}]; const service={getBrowsers:async()=>devices,revokeBrowser:async(id)=>{devices=devices.filter(d=>d.id!==id)},forgetBrowser:async()=>{}}; function blockedWrite(){ window.dispatchEvent(new CustomEvent('lab-admin-reauthenticate',{detail:{resolve:()=>{document.getElementById('result').textContent='已保存'},reject:()=>{}}})); } createRoot(document.getElementById('root')).render(<><LabBrowserSettings service={service}/><LabAdminReauthDialog onVerify={async(code)=>{if(code!=='123456')throw new Error('动态码无效')}}/><button onClick={blockedWrite}>保存设置</button><p id="result"></p></>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "session-security-harness.tsx",
    },
    bundle: true,
    jsx: "automatic",
    outfile: join(directory, "app.js"),
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    logLevel: "silent",
  });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(await readFile(join(directory, "app.js")));
    } else response.end('<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
test("device revoke and administrator reauthentication are usable", async ({ page }) => {
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto(origin);
  await expect(page.getByText("工作电脑")).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("暂无可信浏览器")).toBeVisible();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("动态码").fill("000000");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("动态码无效");
  await page.getByLabel("动态码").fill("123456");
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByText("已保存")).toBeVisible();
});
