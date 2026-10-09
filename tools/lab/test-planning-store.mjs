/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { build } = createRequire(require.resolve("vite"))("esbuild");
const directory = mkdtempSync(join(tmpdir(), "plane-lab-planning-store-"));
try {
  const output = join(directory, "planning-store.test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../../packages/shared-state/src/lab.store.test.ts", import.meta.url))],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
