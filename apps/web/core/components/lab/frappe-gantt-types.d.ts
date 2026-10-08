/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
declare module "frappe-gantt" {
  export type Task = {
    id: string;
    name: string;
    start: string;
    end: string;
    progress?: number;
    dependencies?: string;
    custom_class?: string;
  };
  export type Options = {
    view_mode?: string;
    language?: string;
    readonly?: boolean;
    readonly_progress?: boolean;
    move_dependencies?: boolean;
    popup?: false;
    container_height?: number | "auto";
    snap_at?: string;
    scroll_to?: string;
    on_click?: (task: Task) => void;
    on_date_change?: (task: Task, start: Date, end: Date) => void;
  };
  export default class Gantt {
    constructor(element: HTMLElement, tasks: Task[], options?: Options);
    refresh(tasks: Task[]): void;
    change_view_mode(mode: string): void;
    destroy(): void;
  }
}
