/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LabBountyBudget, LabFinanceOverview, LabPlanner, LabStage } from "../../../packages/types/src/index";

const funds = (data: LabFinanceOverview) => ({
  accounts: data.accounts,
  stages: data.stages,
  batches: data.batches,
  forecasts: data.forecasts,
  settlements: data.settlements,
  commitments: data.commitments,
  payments: data.payments,
  operations: data.operations,
  entries: data.entries,
});

/** Exercises publication through the authenticated UI of the isolated real service. */
export async function verifySimpleBounty(page: Page, fixture: { project: string }): Promise<void> {
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e")
    throw new Error("Simple bounty browser tests require the isolated ooa-plane-e2e project");
  const base = "/api/workspaces/browser-lab/lab/";
  const csrf = (await (await page.request.get("/auth/get-csrf-token/")).json()) as { csrf_token: string };
  const headers = { "X-CSRFToken": csrf.csrf_token };
  const get = async <T>(path: string): Promise<T> => {
    const response = await page.request.get(`${base}${path}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as T;
  };
  const readBudgets = () => get<LabBountyBudget[]>("bounties/budgets/");
  const readStages = () => get<LabStage[]>("stages/");
  const readFunds = async () => funds(await get<LabFinanceOverview>("finance/overview/"));
  const planner = await get<LabPlanner>("planner/");
  const project = planner.projects.find((row) => row.id === fixture.project)!;
  expect(project.lead).toBe(true);
  const reviewer = project.members.find((member) => member.id !== planner.user_id)!;
  expect(reviewer).toBeDefined();

  // An unrelated real project budget makes unintended cross-project deduction observable.
  const otherProjectResponse = await page.request.post("/api/workspaces/browser-lab/projects/", {
    headers,
    data: { name: "Simple bounty unrelated project", identifier: "SIMOTHER", project_lead: planner.user_id },
  });
  expect(otherProjectResponse.status()).toBe(201);
  const otherProject = (await otherProjectResponse.json()) as { id: string };
  const otherBudgetResponse = await page.request.post(`${base}stages/`, {
    headers,
    data: { project_id: otherProject.id, name: "独立项目VC预算", budget: "111" },
  });
  expect(otherBudgetResponse.status()).toBe(201);
  const otherBefore = (await readBudgets()).find((row) => row.project_id === otherProject.id)!;
  expect(otherBefore.available).toBe("111.00");
  const originalStages = await readStages();
  const originalFunds = await readFunds();
  const originalLedger = await get<unknown[]>(`ledger/?project_id=${fixture.project}`);

  await page.goto(`/browser-lab/lab/finance?project_id=${fixture.project}`);
  await page.getByRole("button", { name: "设置 VC 预算", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "设置项目 VC 预算", exact: true });
  await expect(dialog.getByLabel("负责项目", { exact: true })).toHaveValue(fixture.project);
  await dialog.getByLabel("预算名称", { exact: true }).fill("简化发布当前预算");
  await dialog.getByLabel("VC 预算", { exact: true }).fill("25");
  await dialog.getByLabel("操作／核准依据", { exact: true }).fill("隔离浏览器发布预算验收");
  const budgetSaved = page.waitForResponse(
    (response) => response.url().endsWith("/lab/stages/") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const budgetResponse = await budgetSaved;
  expect(budgetResponse.status()).toBe(201);
  const currentStage = (await budgetResponse.json()) as { id: string };
  await expect(dialog).toHaveCount(0);
  const beforePublish = (await readBudgets()).find((row) => row.project_id === fixture.project)!;
  expect(beforePublish).toMatchObject({
    configured: true,
    stage_id: currentStage.id,
    stage_name: "简化发布当前预算",
    budget: "25.00",
    reserved: "0.00",
    available: "25.00",
  });
  expect(
    (await get<LabFinanceOverview>(`finance/overview/?project_id=${fixture.project}`)).stages.some(
      (row) => row.stage_id === currentStage.id
    )
  ).toBe(false);

  const createIssue = async (name: string): Promise<string> => {
    const response = await page.request.post(`/api/workspaces/browser-lab/projects/${fixture.project}/issues/`, {
      headers,
      data: { name, state_id: project.mapping.todo },
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const issue = await createIssue("Simple bounty publication");
  const overBudgetIssue = await createIssue("Simple bounty over-budget attempt");
  await page.goto("/browser-lab/lab/bounties");
  await expect(page.getByRole("button", { name: "冻结阶段预算 B", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批准 WIP 例外", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await dialog.getByLabel("项目", { exact: true }).selectOption(fixture.project);
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issue);
  await dialog.getByLabel("VC配额", { exact: true }).fill("5");
  await dialog.getByLabel("任务资料", { exact: true }).fill("隔离验收原始资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("一份完成复验的实验报告");
  await dialog.getByLabel("验收标准", { exact: true }).fill("报告和数据能够独立复验");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewer.id);
  await expect(dialog.getByLabel("复核人", { exact: true })).toHaveCount(0);
  const published = page.waitForResponse(
    (response) => response.url().endsWith("/lab/bounties/") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  const publishedResponse = await published;
  expect(publishedResponse.status()).toBe(201);
  const publishedBounty = (await publishedResponse.json()) as { id: string };
  const payload = publishedResponse.request().postDataJSON() as Record<string, unknown>;
  expect(payload.project_id).toBe(fixture.project);
  expect(payload.stage_id).toBeUndefined();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看悬赏 Simple bounty publication", exact: true })).toBeVisible();
  expect((await readBudgets()).find((row) => row.project_id === fixture.project)).toMatchObject({
    stage_id: currentStage.id,
    budget: "25.00",
    reserved: "5.00",
    available: "20.00",
  });
  expect((await readBudgets()).find((row) => row.project_id === otherProject.id)).toEqual(otherBefore);
  await page.goto(`/browser-lab/lab/finance?project_id=${fixture.project}`);
  const currentBudget = page.getByRole("region", { name: "项目 VC 预算", exact: true });
  await expect(currentBudget).toContainText("20.00 VC");
  await expect(currentBudget).toContainText("5.00 VC");

  // Use the real endpoint to ensure client-side availability checks cannot bypass the budget.
  const refused = await page.request.post(`${base}bounties/`, {
    headers,
    data: { ...payload, issue_id: overBudgetIssue, budget: "21" },
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain("预算");
  expect((await readBudgets()).find((row) => row.project_id === fixture.project)?.available).toBe("20.00");

  await page.goto(`/browser-lab/lab/bounties?bounty_id=${publishedBounty.id}`);
  await page.locator(`#bounty-${publishedBounty.id}`).getByRole("button", { name: "删除悬赏", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除悬赏", exact: true });
  await dialog.getByLabel("删除原因", { exact: true }).fill("隔离发布流程验收完成，释放未授予配额");
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/bounties/${publishedBounty.id}/detail/`) && response.request().method() === "DELETE"
  );
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await expect(dialog).toHaveCount(0);
  expect((await readBudgets()).find((row) => row.project_id === fixture.project)).toMatchObject({
    stage_id: currentStage.id,
    reserved: "0.00",
    available: "25.00",
  });
  expect((await readBudgets()).find((row) => row.project_id === otherProject.id)).toEqual(otherBefore);
  await page.goto(`/browser-lab/lab/finance?project_id=${fixture.project}`);
  await expect(currentBudget).toContainText("25.00 VC");
  await expect(currentBudget).toContainText("0.00 VC");
  expect((await readStages()).filter((row) => row.id !== currentStage.id)).toEqual(originalStages);
  expect(await readFunds()).toEqual(originalFunds);
  expect(await get<unknown[]>(`ledger/?project_id=${fixture.project}`)).toEqual(originalLedger);

  // A native project with a VC budget can publish without a separate status-mapping setup.
  const addedReviewer = await page.request.post(`/api/workspaces/browser-lab/projects/${otherProject.id}/members/`, {
    headers,
    data: { members: [{ member_id: reviewer.id, role: 15 }] },
  });
  expect(addedReviewer.status()).toBe(201);
  const statesResponse = await page.request.get(`/api/workspaces/browser-lab/projects/${otherProject.id}/states/`);
  expect(statesResponse.status()).toBe(200);
  const states = (await statesResponse.json()) as {
    id: string;
    name: string;
    group: string;
    color: string;
    sequence: number;
    default: boolean;
  }[];
  const todo = states.find((state) => state.group === "unstarted")!;
  expect(todo).toBeDefined();
  const defaultTodo = states.find((state) => state.default && ["backlog", "unstarted"].includes(state.group))!;
  expect(defaultTodo).toBeDefined();
  expect((await get<LabPlanner>("planner/")).projects.find((row) => row.id === otherProject.id)?.mapping).toEqual({
    todo: null,
    active: null,
    review: null,
    done: null,
  });
  const nativeIssueResponse = await page.request.post(
    `/api/workspaces/browser-lab/projects/${otherProject.id}/issues/`,
    {
      headers,
      data: { name: "Fresh native project bounty", state_id: todo.id },
    }
  );
  expect(nativeIssueResponse.status()).toBe(201);
  const createdNativeIssue = (await nativeIssueResponse.json()) as { id: string };
  const nativeIssuePath = `/api/workspaces/browser-lab/projects/${otherProject.id}/issues/${createdNativeIssue.id}/`;
  const nativeBaselineResponse = await page.request.get(nativeIssuePath);
  expect(nativeBaselineResponse.status()).toBe(200);
  const nativeIssue = (await nativeBaselineResponse.json()) as {
    id: string;
    name: string;
    project_id: string;
    state_id: string;
  };
  expect(typeof nativeIssue.state_id).toBe("string");
  expect(nativeIssue.state_id).toBe(todo.id);
  expect(nativeIssue.project_id).toBe(otherProject.id);
  await page.goto("/browser-lab/lab/bounties");
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await dialog.getByLabel("项目", { exact: true }).selectOption(otherProject.id);
  await dialog.getByLabel("工作项", { exact: true }).selectOption(nativeIssue.id);
  await dialog.getByLabel("VC配额", { exact: true }).fill("5");
  await dialog.getByLabel("任务资料", { exact: true }).fill("原生新项目不需要额外配置的发布资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("可复验的完整实验报告");
  await dialog.getByLabel("验收标准", { exact: true }).fill("独立复验通过");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewer.id);
  const nativePublished = page.waitForResponse(
    (response) => response.url().endsWith("/lab/bounties/") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  const nativePublication = await nativePublished;
  expect(nativePublication.status()).toBe(201);
  const nativeBounty = (await nativePublication.json()) as { id: string };
  await expect(dialog).toHaveCount(0);
  expect((await readBudgets()).find((row) => row.project_id === otherProject.id)).toMatchObject({
    budget: "111.00",
    reserved: "5.00",
    available: "106.00",
  });
  expect((await readBudgets()).find((row) => row.project_id === fixture.project)?.available).toBe("25.00");
  const mappedPlanner = await get<LabPlanner>("planner/");
  const mapping = mappedPlanner.projects.find((row) => row.id === otherProject.id)!.mapping;
  expect(Object.values(mapping)).toHaveLength(4);
  expect(Object.values(mapping).every(Boolean)).toBe(true);
  expect(new Set(Object.values(mapping)).size).toBe(4);
  expect(mapping.todo).toBe(defaultTodo.id);
  expect(mappedPlanner.projects.find((row) => row.id === fixture.project)?.mapping).toEqual(project.mapping);
  const mappedStatesResponse = await page.request.get(
    `/api/workspaces/browser-lab/projects/${otherProject.id}/states/`
  );
  expect(mappedStatesResponse.status()).toBe(200);
  const mappedStates = (await mappedStatesResponse.json()) as typeof states;
  for (const state of states) {
    expect(mappedStates.find((row) => row.id === state.id)).toMatchObject({
      id: state.id,
      name: state.name,
      group: state.group,
      color: state.color,
      sequence: state.sequence,
      default: state.default,
    });
  }
  await page.goto(`/browser-lab/lab/finance?project_id=${otherProject.id}`);
  await expect(currentBudget).toContainText("106.00 VC");
  await page.goto(`/browser-lab/lab/bounties?bounty_id=${nativeBounty.id}`);
  await page.locator(`#bounty-${nativeBounty.id}`).getByRole("button", { name: "删除悬赏", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除悬赏", exact: true });
  await dialog.getByLabel("删除原因", { exact: true }).fill("原生项目发布验收完成");
  const nativeDeleted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/bounties/${nativeBounty.id}/detail/`) && response.request().method() === "DELETE"
  );
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  expect((await nativeDeleted).status()).toBe(204);
  await expect(dialog).toHaveCount(0);
  expect((await readBudgets()).find((row) => row.project_id === otherProject.id)).toEqual(otherBefore);
  const retainedIssueResponse = await page.request.get(nativeIssuePath);
  expect(retainedIssueResponse.status()).toBe(200);
  expect((await retainedIssueResponse.json()) as typeof nativeIssue).toMatchObject({
    id: nativeIssue.id,
    name: nativeIssue.name,
    project_id: nativeIssue.project_id,
    state_id: nativeIssue.state_id,
  });
  expect((await readStages()).filter((row) => row.id !== currentStage.id)).toEqual(originalStages);
  expect(await readFunds()).toEqual(originalFunds);
  expect(await get<unknown[]>(`ledger/?project_id=${fixture.project}`)).toEqual(originalLedger);
  process.stdout.write(
    "[lab-e2e bounty] finance VC budget, simple native-project publication, server ceiling and release preserve historical cash and VC\n"
  );
}
