/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
/* oxlint-disable no-await-in-loop -- These cycles must run serially to measure mount/unmount listener ownership. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch();
try {
  for (const format of ["es", "umd"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const prefix = new URL("../../apps/web/node_modules/frappe-gantt/dist/", import.meta.url);
    await page.setContent(
      `<style>${readFileSync(new URL("frappe-gantt.css", prefix), "utf8")}</style><div id="chart" style="width:1100px;height:600px"></div>`
    );
    if (format === "umd") {
      await page.addScriptTag({ path: fileURLToPath(new URL("frappe-gantt.umd.js", prefix)) });
    } else {
      const encoded = readFileSync(new URL("frappe-gantt.es.js", prefix)).toString("base64");
      await page.evaluate(async (source) => {
        window.Gantt = (await import(`data:text/javascript;base64,${source}`)).default;
      }, encoded);
    }
    const cdp = await page.context().newCDPSession(page);
    async function listenerCount() {
      const handle = await cdp.send("Runtime.evaluate", { expression: "document", objectGroup: "frappe-lifecycle" });
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: handle.result.objectId });
      await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "frappe-lifecycle" });
      return listeners.filter((event) => event.type === "mouseup").length;
    }
    const baseline = await listenerCount();
    for (let cycle = 0; cycle < 12; cycle += 1) {
      await page.evaluate(() => {
        window.labChart?.destroy();
        window.labChart = new window.Gantt(
          document.getElementById("chart"),
          [{ id: "task", name: "实验", start: "2026-10-08", end: "2026-10-10" }],
          { popup: false, view_mode: "Week" }
        );
      });
      assert.equal(await listenerCount(), baseline + 1, `${format}: rebuild ${cycle} leaked a global mouseup listener`);
      await page.evaluate(() => {
        window.labChart.destroy();
        window.labChart.destroy();
      });
      assert.equal(await listenerCount(), baseline, `${format}: destroy did not release its mouseup listener`);
    }
    await cdp.detach();
    await page.close();
    console.log(`${format}: 12 mount/destroy cycles released all document mouseup listeners`);
  }
} finally {
  await browser.close();
}
