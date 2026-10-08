/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { LabFieldKind, LabFieldValue } from "@plane/types";
export type { LabFieldKind, LabFieldValue, LabCustomField, LabTaskRow } from "@plane/types";
export const fieldKindNames: Record<LabFieldKind, string> = {
  text: "文本",
  number: "数字",
  single_select: "单选",
  multi_select: "多选",
  date: "日期",
  member: "成员",
  boolean: "是／否",
  url: "网址",
};
export function fieldValueText(value: LabFieldValue | undefined): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join("、");
  return typeof value === "boolean" ? (value ? "是" : "否") : String(value);
}
export function csvText(rows: unknown[][]): string {
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell ?? "");
            const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(",")
      )
      .join("\r\n")
  );
}
export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
