/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { LabCalendarColor, LabEvent } from "@plane/types";

export const calendarColors: { value: Exclude<LabCalendarColor, "">; name: string; hex: string }[] = [
  { value: "blue", name: "蓝色", hex: "#1d4ed8" },
  { value: "purple", name: "紫色", hex: "#7c3aed" },
  { value: "green", name: "绿色", hex: "#15803d" },
  { value: "orange", name: "橙色", hex: "#c2410c" },
  { value: "pink", name: "粉色", hex: "#be185d" },
  { value: "cyan", name: "青色", hex: "#0e7490" },
];
export const calendarCategories: { kind: string; name: string; color: LabCalendarColor }[] = [
  { kind: "project", name: "项目任务", color: "blue" },
  { kind: "research", name: "科研", color: "purple" },
  { kind: "study", name: "学习", color: "green" },
  { kind: "mentoring", name: "带教", color: "orange" },
];
export function calendarColor(event: Pick<LabEvent, "kind" | "color">) {
  // Opaque busy events never use a private category or manual color.
  if (!event.kind) return "#64748b";
  const value = event.color || calendarCategories.find((category) => category.kind === event.kind)?.color || "purple";
  return calendarColors.find((color) => color.value === value)?.hex ?? "#7c3aed";
}
