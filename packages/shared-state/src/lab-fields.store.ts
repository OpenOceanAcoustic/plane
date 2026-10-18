/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { makeAutoObservable, runInAction } from "mobx";
import type { LabCustomField, LabTaskArchiveFilters, LabTaskRow, LabTaskTableData } from "@plane/types";
import type { LabStore } from "./lab.store";

/** Canonical task values with request ordering shared by every table consumer. */
export class LabFieldsStore {
  tasks: LabTaskRow[] = [];
  fields: LabCustomField[] = [];
  canArchive = false;
  private requestSerial = 0;
  private selectionKey: string | undefined;
  constructor(readonly transport: LabStore) {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  invalidateLoads() {
    this.requestSerial += 1;
  }
  async load(projectId = "", filters: LabTaskArchiveFilters = {}): Promise<LabTaskTableData | undefined> {
    const serial = ++this.requestSerial;
    const query = new URLSearchParams();
    if (projectId) query.set("project", projectId);
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    const selection = query.toString();
    if (this.selectionKey !== selection) {
      this.selectionKey = selection;
      this.tasks = [];
      this.fields = [];
      this.canArchive = false;
    }
    try {
      const data = await this.transport.request<LabTaskTableData>(`task-table/${selection ? `?${selection}` : ""}`);
      if (serial !== this.requestSerial) return undefined;
      runInAction(() => {
        this.tasks = data.tasks;
        this.fields = data.fields;
        this.canArchive = data.can_archive === true;
      });
      return data;
    } catch (error) {
      if (serial === this.requestSerial) throw error;
      return undefined;
    }
  }
  async update(issueId: string, fieldId: string, value: unknown) {
    const data = await this.transport.request<{ values: LabTaskRow["values"] }>(
      `tasks/${issueId}/field-values/`,
      "PATCH",
      { values: { [fieldId]: value } }
    );
    runInAction(() => {
      // TanStack caches accessor/filter results by the data reference.
      this.tasks = this.tasks.map((row) => (row.id === issueId ? { ...row, values: data.values } : row));
    });
  }
}
