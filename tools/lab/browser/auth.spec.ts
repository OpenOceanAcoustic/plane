/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { expect, test } from "@playwright/test";

test("StrictMode preserves a one-use fragment until binding, without sending it in page URLs", async ({ page }) => {
  let enrolled = false,
    confirmed = false;
  const pageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET") pageRequests.push(request.url());
  });
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test-csrf" } }));
  await page.route("**/auth/lab/enroll/", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      token: "one-use-invitation",
      username: "alice",
      display_name: "成员",
      email: "alice@example.org",
    });
    enrolled = true;
    await route.fulfill({
      json: {
        token: "binding-token",
        username: "alice",
        rebind: false,
        qr: "data:image/png;base64,iVBORw0KGgo=",
        otpauth: "otpauth://totp/lab?secret=TEST",
      },
    });
  });
  await page.route("**/auth/lab/confirm/", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: "binding-token", code: "123456" });
    confirmed = true;
    await route.fulfill({ status: 201, json: { username: "alice" } });
  });
  await page.goto("/register#one-use-invitation");
  await expect(page.getByRole("button", { name: "开始绑定" })).toBeVisible();
  await expect(page).toHaveURL("http://127.0.0.1:3105/register");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page.getByLabel("显示姓名").fill("成员");
  await page.getByLabel("联系邮箱").fill("alice@example.org");
  await page.getByRole("button", { name: "开始绑定" }).click();
  await expect(page.getByAltText("Authenticator 绑定二维码")).toBeVisible();
  await page.getByLabel("六位动态码").fill("123456");
  await page.getByRole("button", { name: "确认绑定" }).click();
  await expect(page.getByRole("status")).toContainText("绑定成功");
  expect(enrolled && confirmed).toBeTruthy();
  expect(pageRequests.every((url) => !url.includes("one-use-invitation"))).toBeTruthy();
});

test("no invite offers no registration form and login exposes only username and dynamic code", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("button", { name: "开始绑定" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  await expect(page.getByLabel("六位动态码")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText("忘记密码", { exact: true })).toHaveCount(0);
});

test("account rate limit displays the backend's remaining wait time", async ({ page }) => {
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test-csrf" } }));
  await page.route("**/auth/lab/sign-in/", (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "481" },
      json: { error: "请求过于频繁，请稍后重试", retry_after: 481 },
    })
  );
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("ALICE");
  await page.getByLabel("六位动态码").fill("123456");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("481 秒");
});
