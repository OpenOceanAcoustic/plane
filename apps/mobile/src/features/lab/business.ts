/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { calendarInstant } from "./calendar-time";
export function newRequestKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const text = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
export function scheduleMutation(event: { id: string; revision?: number } | undefined, start: string, end: string) {
  const from = calendarInstant(start),
    to = calendarInstant(end);
  if (new Date(from) >= new Date(to)) throw new Error("结束时间必须晚于开始时间");
  return { ...(event ? { expected_revision: event.revision } : {}), start: from, end: to };
}
export function contributionQuery(month: string, project = "", day = "", cursor = "") {
  const query = new URLSearchParams({ month });
  if (project) query.set("project_id", project);
  if (day) query.set("day", day);
  if (cursor) query.set("cursor", cursor);
  return query;
}
export function monthDays(month: string): string[] {
  const [year, value] = month.split("-").map(Number);
  return Array.from(
    { length: new Date(Date.UTC(year!, value!, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`
  );
}
export function today() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
