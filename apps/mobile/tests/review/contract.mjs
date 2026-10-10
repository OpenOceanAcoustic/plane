import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
try {
  await page.goto(`${process.env.MOBILE_PREVIEW_URL || "http://127.0.0.1:4323"}/tests/review/index.html`);
  await expect(page.getByLabel("revision")).not.toHaveText("0");
  const old = await page.getByLabel("revision").textContent();
  await page.evaluate(() => window.dispatchEvent(new Event("mobileResume")));
  await expect(page.getByLabel("revision")).not.toHaveText(old, { timeout: 3000 });
  await page.getByRole("button", { name: "child", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("mobileBack", { cancelable: true })));
  await expect(page.getByRole("dialog", { name: "child", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "parent", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "lab child", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("mobileBack", { cancelable: true })));
  await expect(page.getByRole("dialog", { name: "lab child", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "parent", exact: true })).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("mobileBack", { cancelable: true })));
  await page.getByRole("button", { name: "form", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在保存…", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("mobileBack", { cancelable: true })));
  await expect(page.getByRole("dialog", { name: "saving", exact: true })).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("completeSave")));
  await expect(page.getByRole("dialog", { name: "saving", exact: true })).toHaveCount(0);
  console.log(
    JSON.stringify({
      passed: 4,
      checks: ["foreground refresh", "topmost sheet back", "mixed dialog families", "in-flight save blocks dismissal"],
    })
  );
} finally {
  await browser.close();
}
