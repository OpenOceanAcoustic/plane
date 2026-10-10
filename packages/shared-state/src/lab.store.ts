/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { makeAutoObservable, runInAction } from "mobx";
import type { LabBounty, LabEvent, LabMember, LabPlanner, LabStage, LabTodo } from "@plane/types";

/** Owns transport and server state; project task identity stays in the Django API. */
export class LabStore {
  planner: LabPlanner | undefined;
  events: LabEvent[] = [];
  members: LabMember[] = [];
  stages: LabStage[] = [];
  bounties: LabBounty[] = [];
  todos: LabTodo[] = [];
  busy = false;
  error = "";
  notice = "";
  private plannerRequestId = 0;
  private calendarRequestId = 0;
  private marketRequestId = 0;
  private deletedBountyIds = new Set<string>();

  constructor(
    readonly apiBase: string,
    readonly slug: string
  ) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  private async responseError(response: Response): Promise<Error> {
    let data: { error?: string; detail?: string } | string[];
    try {
      data = await response.json();
    } catch {
      return new Error("请求失败，请稍后重试");
    }
    return new Error(
      Array.isArray(data)
        ? data.join("；")
        : typeof data?.error === "string"
          ? data.error
          : typeof data?.detail === "string"
            ? data.detail
            : "请求失败，请检查权限和填写内容"
    );
  }

  private async send(path: string, method = "GET", body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    const multipart = body instanceof FormData;
    if (method !== "GET") {
      const csrfResponse = await fetch(`${this.apiBase}/auth/get-csrf-token/`, { credentials: "include" });
      if (!csrfResponse.ok) throw await this.responseError(csrfResponse);
      const csrf = (await csrfResponse.json()) as { csrf_token: string };
      if (typeof csrf.csrf_token !== "string" || !csrf.csrf_token) throw new Error("会话验证失败，请刷新后重试");
      headers["X-CSRFToken"] = csrf.csrf_token;
      if (!multipart) headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`${this.apiBase}/api/workspaces/${encodeURIComponent(this.slug)}/lab/${path}`, {
      credentials: "include",
      method,
      headers,
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    });
    if (!response.ok) throw await this.responseError(response);
    return response;
  }

  async upload<T>(path: string, data: FormData): Promise<T> {
    return this.request<T>(path, "POST", data);
  }

  async download(path: string): Promise<{ blob: Blob }> {
    const response = await this.send(path);
    return { blob: await response.blob() };
  }

  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.send(path, method, body);
    if (response.status === 204) {
      const removed = method === "DELETE" ? /^bounties\/([^/]+)\/detail\/$/.exec(path) : null;
      if (removed) {
        const id = decodeURIComponent(removed[1]!);
        runInAction(() => {
          this.deletedBountyIds.add(id);
          ++this.marketRequestId;
          this.bounties = this.bounties.filter((row) => row.id !== id);
          this.todos = this.todos.filter((row) => row.id !== id);
        });
      }
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async loadPlanner() {
    const requestId = ++this.plannerRequestId;
    const planner = await this.request<LabPlanner>("planner/");
    runInAction(() => {
      if (requestId !== this.plannerRequestId) return;
      this.planner = planner;
    });
  }

  async loadCalendar(start: string, end: string, team: boolean, filters: { userId?: string; projectId?: string } = {}) {
    const requestId = ++this.calendarRequestId;
    const query = new URLSearchParams({ start, end, team: team ? "1" : "0" });
    if (filters.userId) query.set("user_id", filters.userId);
    if (filters.projectId) query.set("project_id", filters.projectId);
    const calendar = await this.request<{ events: LabEvent[]; members: LabMember[] }>(`calendar/?${query}`);
    runInAction(() => {
      if (requestId !== this.calendarRequestId) return;
      this.events = calendar.events;
      this.members = calendar.members;
    });
  }

  async loadMarket() {
    const requestId = ++this.marketRequestId;
    const [stages, bounties, todos] = await Promise.all([
      this.request<LabStage[]>("stages/"),
      this.request<LabBounty[]>("bounties/"),
      this.request<LabTodo[]>("inbox/"),
    ]);
    runInAction(() => {
      if (requestId !== this.marketRequestId) return;
      this.stages = stages;
      this.bounties = bounties.filter((row) => row.status !== "deleted" && !this.deletedBountyIds.has(row.id));
      this.todos = todos.filter((row) => !this.deletedBountyIds.has(row.id));
    });
  }

  async loadBountyDetail(id: string) {
    const bounty = await this.request<LabBounty>(`bounties/${encodeURIComponent(id)}/detail/`);
    runInAction(() => {
      if (bounty.status === "deleted" || this.deletedBountyIds.has(id)) return;
      const index = this.bounties.findIndex((row) => row.id === id);
      if (index >= 0) this.bounties[index] = bounty;
      else this.bounties.push(bounty);
    });
    return bounty;
  }

  async execute(action: () => Promise<void>) {
    this.busy = true;
    this.error = "";
    try {
      await action();
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : "操作失败";
      });
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }
}
