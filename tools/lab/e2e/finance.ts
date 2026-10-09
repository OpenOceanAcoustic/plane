/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LabEvent, LabLedgerEntry, LabPlanner } from "../../../packages/types/src/index";

type FinanceFixture = {
  stage: string;
  bounty: string;
  issue: string;
  user: string;
  item: string;
  category_color: string;
  formula_version: number;
  task_forecast: string;
  member_forecast: string;
  task_amount: string;
  member_amount: string;
  batch: string;
  version: string;
};
type Overview = {
  accounts: { id: string; stage_id: string | null; kind: string; balance: string; available: string }[];
  settlements: {
    id: string;
    stage_id: string;
    amount: string;
    difference: string;
    paid: string;
    outstanding: string;
    committed: string;
  }[];
  commitments: { id: string; settlement_id: string; amount: string; remaining: string }[];
  payments: { id: string; commitment_id: string; gross: string; withheld: string; net: string }[];
};

function milestone(label: string): void {
  process.stdout.write(`[lab-e2e finance] ${label}\n`);
}

/** Uses real deployed services and the already authenticated isolated TOTP session. */
export async function verifyFinance(page: Page, fixture: { project: string }): Promise<void> {
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e")
    throw new Error("Finance browser tests require the isolated ooa-plane-e2e project");
  if (!/^[0-9a-f-]{36}$/i.test(fixture.project)) throw new Error("Invalid isolated project fixture ID");
  const output = execFileSync(
    "docker",
    ["compose", "-p", "ooa-plane-e2e", "-f", "compose.lab.yml", "exec", "-T", "api", "python", "manage.py", "shell"],
    {
      input: `project_id = '${fixture.project}'\n${readFileSync("tools/lab/e2e/seed-finance.py", "utf8")}`,
      encoding: "utf8",
    }
  );
  const seed = JSON.parse(
    output
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"))!
  ) as FinanceFixture;
  expect(seed.task_amount).toBe("200.00");
  expect(seed.member_amount).toBe("440.00");
  const base = "/api/workspaces/browser-lab/lab/";
  const financePath = `/browser-lab/lab/finance?project_id=${fixture.project}`;
  const overview = async (): Promise<Overview> => {
    const response = await page.request.get(`${base}finance/overview/?project_id=${fixture.project}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as Overview;
  };
  const save = async (action: string): Promise<{ id: string }> => {
    const completed = page.waitForResponse(
      (response) => response.url().endsWith(`/lab/finance/${action}/`) && response.request().method() === "POST"
    );
    await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
    const response = await completed;
    expect(response.status()).toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return (await response.json()) as { id: string };
  };
  const justification = async (reason: string): Promise<void> => {
    await page.getByRole("dialog").getByLabel("操作／核准依据", { exact: true }).fill(reason);
  };

  await page.goto(financePath);
  await expect(page.getByRole("heading", { name: "资金账户实际余额", exact: true })).toBeVisible();
  let data = await overview();
  expect(data.accounts.find((row) => row.stage_id === seed.stage && row.kind === "execution")!.balance).toBe("1400.00");
  expect(data.accounts.find((row) => row.stage_id === seed.stage && row.kind === "risk")!.balance).toBe("100.00");
  await page.getByRole("button", { name: "预算与参考预测", exact: true }).click();
  const snapshots = page.getByRole("region", { name: "已保存预测快照", exact: true });
  await expect(snapshots).toContainText("¥440.00");
  await expect(snapshots).toContainText(`v${seed.formula_version}`);
  milestone("project formula, frozen budget and actual pool balances verified");

  // Final amount deliberately differs from the frozen 440 yuan reference.
  await page.getByLabel("办理资金事项", { exact: true }).selectOption("settlement");
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("阶段", { exact: true }).selectOption(seed.stage);
  await dialog.getByLabel("奖励成员", { exact: true }).selectOption(seed.user);
  await dialog.getByLabel("个人阶段累计最终核准金额（元）", { exact: true }).fill("300");
  await dialog.getByLabel("绩效与核准依据", { exact: true }).fill("根据实际成果核准300元，参考金额仅用于比较");
  await dialog.getByLabel("关联参考预测（可选）", { exact: true }).selectOption(seed.member_forecast);
  await justification("负责人独立核准最终执行奖励");
  const settlement = await save("settlement");
  await page.getByRole("button", { name: "核准与付款", exact: true }).click();
  const finalRecords = page.getByRole("region", { name: "最终核准与预测差异", exact: true });
  await expect(finalRecords).toContainText("¥-140.00");
  await expect(finalRecords).toContainText("¥300.00");
  await finalRecords.getByRole("button", { name: "安排支付", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("已核准奖励", { exact: true })).toHaveValue(settlement.id);
  await dialog.getByLabel("本次支付安排金额（元）", { exact: true }).fill("300");
  await justification("安排真实可用现金，等待线下分期付款");
  const commitment = await save("commit");
  const paymentArrangements = page.getByRole("region", { name: "现金支付安排", exact: true });
  await expect(paymentArrangements).toContainText("¥300.00");

  const registerPayment = async (gross: string, withheld: string, reference: string): Promise<void> => {
    await paymentArrangements.getByRole("button", { name: "登记线下支付", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("已批准的现金支付安排", { exact: true })).toHaveValue(commitment.id);
    await dialog.getByLabel("本次核销应付（元）", { exact: true }).fill(gross);
    await dialog.getByLabel("本次扣缴（元）", { exact: true }).fill(withheld);
    await dialog.getByLabel("线下付款凭证号", { exact: true }).fill(reference);
    await dialog.getByLabel("凭证或证据引用", { exact: true }).fill(`隔离浏览器验收凭证 ${reference}`);
    await justification("登记已发生的线下分期付款");
    await save("payment");
    data = await overview();
    const award = data.settlements.find((row) => row.id === settlement.id)!;
    expect(award.amount).toBe("300.00");
    expect(award.paid).toBe(gross === "100" ? "100.00" : "300.00");
    expect(award.outstanding).toBe(gross === "100" ? "200.00" : "0.00");
    expect(award.committed).toBe(gross === "100" ? "200.00" : "0.00");
  };
  await registerPayment("100", "10", "E2E-PAYMENT-1");
  await registerPayment("200", "0", "E2E-PAYMENT-2");
  data = await overview();
  expect(data.accounts.find((row) => row.stage_id === seed.stage && row.kind === "execution")!.balance).toBe("1100.00");
  expect(
    data.payments
      .filter((row) => row.commitment_id === commitment.id)
      .map((row) => row.net)
      .toSorted()
  ).toEqual(["200.00", "90.00"]);
  await expect(finalRecords).toContainText("¥290.00");
  milestone("manual award and two real offline payments preserve differences and withholding");

  await page.getByRole("button", { name: "资金与项目流程", exact: true }).click();
  const cashFlow = page.getByRole("region", { name: "资金流程图", exact: true });
  const projectFlow = page.getByRole("region", { name: "项目流程图", exact: true });
  await expect(cashFlow.locator(".react-flow__nodes")).toBeVisible();
  await expect(projectFlow.locator(".react-flow__nodes")).toBeVisible();
  await expect(cashFlow).toContainText("浏览器真实资金阶段");
  await expect(cashFlow).toContainText("登记已发生的线下分期付款");
  await page.getByRole("button", { name: "账目明细", exact: true }).click();
  await expect(page.getByRole("link", { name: "导出可见资金账 CSV", exact: true })).toBeVisible();
  const csv = await page.request.get(`${base}finance/entries/?project_id=${fixture.project}&format=csv`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("隔离到账凭证 E2E-RECEIPT");
  milestone("real finance flow, project flow and permission-scoped cash export verified");

  await page.goto(`/browser-lab/lab/bounties?bounty_id=${seed.bounty}`);
  await page.getByRole("button", { name: "全部悬赏", exact: true }).click();
  const card = page.getByRole("button", { name: "查看悬赏 Finance browser bounty", exact: true });
  await expect(card.getByLabel("悬赏任务", { exact: true })).toBeVisible();
  await expect(card).toContainText("预计 ¥200.00");
  await expect(card).toHaveCSS("border-color", "rgb(13, 148, 136)");
  const bounty = page.locator(`#bounty-${seed.bounty}`);
  await expect(bounty).toContainText("预算预计奖励 ¥200.00");
  await bounty.getByRole("button", { name: "查看流程图", exact: true }).click();
  await expect(bounty.getByRole("region", { name: "悬赏流程图", exact: true })).toContainText("完成与 VC 记账");

  const materials = bounty.getByRole("region", { name: "悬赏共享资料", exact: true });
  await materials.getByRole("button", { name: "共享附件／文档版本", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("选择具体资料", { exact: true }).selectOption(seed.version);
  await dialog.getByLabel("给参与成员显示的名称", { exact: true }).fill("财务验收共享资料");
  const shared = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/bounties/${seed.bounty}/materials/`) && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const sharedResponse = await shared;
  expect(sharedResponse.status()).toBe(201);
  const material = (await sharedResponse.json()) as { id: string };
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await materials.getByRole("button", { name: "读取共享版本", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("冻结的财务执行证据 v1");
  await expect(dialog).not.toContainText("未共享的新版本");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await materials.getByRole("button", { name: "撤回共享", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "撤回共享", exact: true }).click();
  await expect(materials).toContainText("尚无已共享的执行资料");
  expect((await page.request.get(`${base}bounties/${seed.bounty}/materials/${material.id}/`)).status()).toBe(404);
  milestone("colored bounty card and explicit document version withdrawal verified");

  await page.goto("/browser-lab/lab/planner");
  const planningCard = page.locator("article.lab-planner-card").filter({ hasText: "Finance browser bounty" });
  await expect(planningCard).toHaveCount(1);
  await expect(planningCard.getByLabel("悬赏任务", { exact: true })).toBeVisible();
  await expect(planningCard).toHaveCSS("border-color", "rgb(13, 148, 136)");
  await page.goto(`/browser-lab/projects/${fixture.project}/issues`);
  // The earlier Gantt check saved this layout. Header buttons appear before
  // project preferences load, when updateFilters still ignores layout changes.
  const savedGantt = page.getByTestId("lab-project-gantt");
  await expect(savedGantt).toBeVisible();
  await expect(savedGantt).toContainText("Original project task");
  const kanban = page.getByRole("button", { name: /看板|Kanban/i }).first();
  await kanban.click();
  await expect(kanban).toHaveAttribute("aria-pressed", "true");
  const nativeCard = page.locator(`#issue-${seed.issue}`);
  await expect(nativeCard).toBeVisible();
  await expect(nativeCard.getByLabel("悬赏任务", { exact: true })).toBeVisible();
  await expect(nativeCard.locator("a").first()).toHaveCSS("border-color", "rgb(13, 148, 136)");
  milestone("automatic personal reference and native kanban share the viewer's category marker");

  // Exercise deletion of a paid task with an existing personal folder and schedule.
  const csrf = (await (await page.request.get("/auth/get-csrf-token/")).json()) as { csrf_token: string };
  const headers = { "X-CSRFToken": csrf.csrf_token };
  const readPlanner = async (): Promise<LabPlanner> => {
    const response = await page.request.get(`${base}planner/`);
    expect(response.status()).toBe(200);
    return (await response.json()) as LabPlanner;
  };
  let savedPlanner = await readPlanner();
  expect(savedPlanner.folders.length).toBeGreaterThan(0);
  const folder = savedPlanner.folders[0]!;
  const moved = await page.request.patch(`${base}items/${seed.item}/`, { headers, data: { folder_id: folder.id } });
  expect(moved.status()).toBe(200);
  const blockStart = new Date(Math.ceil(Date.now() / 900000) * 900000 + 24 * 60 * 60 * 1000);
  const blockEnd = new Date(blockStart.getTime() + 60 * 60 * 1000);
  const scheduled = await page.request.post(`${base}calendar/`, {
    headers,
    data: { item_id: seed.item, start: blockStart.toISOString(), end: blockEnd.toISOString(), color: "#6366f1" },
  });
  expect(scheduled.status()).toBe(201);
  const block = (await scheduled.json()) as { id: string };
  const calendarPath = `${base}calendar/?${new URLSearchParams({ start: blockStart.toISOString(), end: blockEnd.toISOString() })}`;
  const readEvent = async (): Promise<LabEvent> => {
    const response = await page.request.get(calendarPath);
    expect(response.status()).toBe(200);
    const { events } = (await response.json()) as { events: LabEvent[] };
    const event = events.find((row) => row.id === block.id);
    expect(event).toBeDefined();
    return event!;
  };
  const readLedger = async (): Promise<LabLedgerEntry[]> => {
    const response = await page.request.get(`${base}ledger/?project_id=${fixture.project}`);
    expect(response.status()).toBe(200);
    return ((await response.json()) as LabLedgerEntry[]).toSorted((left, right) => left.id.localeCompare(right.id));
  };
  savedPlanner = await readPlanner();
  const savedReference = savedPlanner.items.find((row) => row.id === seed.item)!;
  expect(savedReference.folder_id).toBe(folder.id);
  expect(savedReference.category_color).toBe(seed.category_color);
  expect(savedReference.schedule.total_count).toBe(1);
  const savedEvent = await readEvent();
  expect(savedEvent.bounty_id).toBe(seed.bounty);
  const fundsBeforeDeletion = await overview();
  const ledgerBeforeDeletion = await readLedger();
  expect(ledgerBeforeDeletion.find((row) => row.bounty_id === seed.bounty)?.delta).toBe("20.00");

  await page.goto(`/browser-lab/lab/bounties?bounty_id=${seed.bounty}`);
  await page.getByRole("button", { name: "全部悬赏", exact: true }).click();
  await expect(card).toBeVisible();
  await bounty.getByRole("button", { name: "删除悬赏", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除悬赏", exact: true });
  await dialog.getByLabel("删除原因", { exact: true }).fill("移除已完成卡片，保留已核准及已付款事实");
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/bounties/${seed.bounty}/detail/`) && response.request().method() === "DELETE"
  );
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(bounty).toHaveCount(0);
  const fundsAfterDeletion = await overview();
  expect(fundsAfterDeletion.accounts).toEqual(fundsBeforeDeletion.accounts);
  expect(fundsAfterDeletion.settlements).toEqual(fundsBeforeDeletion.settlements);
  expect(fundsAfterDeletion.commitments).toEqual(fundsBeforeDeletion.commitments);
  expect(fundsAfterDeletion.payments).toEqual(fundsBeforeDeletion.payments);
  expect(await readLedger()).toEqual(ledgerBeforeDeletion);
  const retainedReference = (await readPlanner()).items.find((row) => row.id === seed.item)!;
  expect(retainedReference.issue_id).toBe(savedReference.issue_id);
  expect(retainedReference.folder_id).toBe(savedReference.folder_id);
  expect(retainedReference.category_id).toBe(savedReference.category_id);
  expect(retainedReference.category_color).toBe(savedReference.category_color);
  expect(retainedReference.schedule).toEqual(savedReference.schedule);
  expect(retainedReference.bounty_id).toBeUndefined();
  const retainedEvent = await readEvent();
  expect({ ...retainedEvent, bounty_id: undefined, bounty_status: undefined, bounty_detail_url: undefined }).toEqual({
    ...savedEvent,
    bounty_id: undefined,
    bounty_status: undefined,
    bounty_detail_url: undefined,
  });
  expect(retainedEvent.bounty_id).toBeUndefined();
  await page.goto("/browser-lab/lab/planner");
  await expect(planningCard).toHaveCount(1);
  await expect(planningCard).toContainText("财务验收分类");
  await expect(planningCard.getByLabel("悬赏任务", { exact: true })).toHaveCount(0);
  await page.goto(`/browser-lab/projects/${fixture.project}/issues`);
  await expect(nativeCard).toBeVisible();
  await expect(nativeCard.getByLabel("悬赏任务", { exact: true })).toHaveCount(0);
  milestone("published bounty deletion preserves paid cash, earned VC, personal folder, colors and schedule");
}
