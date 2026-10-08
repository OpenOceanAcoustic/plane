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

  constructor(
    readonly apiBase: string,
    readonly slug: string
  ) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== "GET") {
      const csrfResponse = await fetch(`${this.apiBase}/auth/get-csrf-token/`, { credentials: "include" });
      const csrf = (await csrfResponse.json()) as { csrf_token: string };
      headers["X-CSRFToken"] = csrf.csrf_token;
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`${this.apiBase}/api/workspaces/${encodeURIComponent(this.slug)}/lab/${path}`, {
      credentials: "include",
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const data = (await response.json()) as T & { error?: string; detail?: string };
    if (!response.ok)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data)
              ? data.join("；")
              : "请求失败，请检查权限和填写内容"
      );
    return data;
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
    const stages = await this.request<LabStage[]>("stages/");
    const bounties = await this.request<LabBounty[]>("bounties/");
    const todos = await this.request<LabTodo[]>("inbox/");
    runInAction(() => {
      this.stages = stages;
      this.bounties = bounties;
      this.todos = todos;
    });
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
