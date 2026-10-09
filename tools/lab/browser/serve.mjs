/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const webRequire = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const viteRequire = createRequire(webRequire.resolve("vite"));
const { build } = viteRequire("esbuild");
const uiRequire = createRequire(new URL("../../../packages/ui/package.json", import.meta.url));
const built = await build({
  entryPoints: [fileURLToPath(new URL("harness.tsx", import.meta.url))],
  bundle: true,
  write: false,
  outfile: "/tmp/plane-lab-browser/harness.js",
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  define: { "process.env": '{"NODE_ENV":"development"}' },
  alias: {
    react: dirname(uiRequire.resolve("react")),
    "react-dom": dirname(webRequire.resolve("react-dom")),
    "mobx-react": webRequire.resolve("mobx-react"),
    "react-router": webRequire.resolve("react-router"),
    "@plane/propel/toast": fileURLToPath(new URL("../../../packages/propel/src/toast/index.ts", import.meta.url)),
    "@plane/ui": fileURLToPath(new URL("ui-entry.ts", import.meta.url)),
  },
});
const script = built.outputFiles.find((file) => file.path.endsWith(".js"));
if (!script) throw new Error("Browser harness JavaScript was not generated");
const calendarStyles = built.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
const assetDir = process.env.LAB_BROWSER_ASSET_DIR
  ? resolve(process.env.LAB_BROWSER_ASSET_DIR)
  : fileURLToPath(new URL("../../../apps/web/build/client/assets/", import.meta.url));
const styles = readdirSync(assetDir)
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(resolve(assetDir, file), "utf8"))
  .join("\n");
const html =
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/harness.css"><style>body{font-family:system-ui;padding:24px}button,input,select{font:inherit}dialog{width:460px;border-radius:8px}label{display:block;margin:8px}img{display:block}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>';
createServer((req, res) => {
  if (req.url === "/harness.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(calendarStyles);
    return;
  }
  if (req.url === "/theme.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(styles);
    return;
  }
  res.setHeader("Content-Type", req.url === "/harness.js" ? "text/javascript" : "text/html; charset=utf-8");
  res.end(req.url === "/harness.js" ? script.contents : html);
}).listen(Number(process.env.LAB_BROWSER_PORT ?? "3105"), "127.0.0.1", () =>
  process.stdout.write("Lab component browser harness ready\n")
);
