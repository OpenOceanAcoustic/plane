/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { LabEvent } from "@plane/types";

const validColor = (value?: string | null) => Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
export function calendarColor(event: Pick<LabEvent, "kind" | "color" | "category_color">) {
  // Opaque busy events never use a private category or manual color.
  if (!event.kind) return "#64748b";
  return validColor(event.color) ? event.color! : validColor(event.category_color) ? event.category_color! : "#64748b";
}
export function calendarLegend(events: LabEvent[]) {
  const entries = new Map<string, { id: string; name: string; color: string }>();
  for (const event of events) {
    const color = calendarColor(event).toLowerCase();
    // Use exactly the visible, permission-filtered projection, including opaque busy blocks.
    const category = event.kind ? (event.category_name ?? "未分类") : "忙碌";
    const manual = Boolean(event.kind && validColor(event.color));
    const id = JSON.stringify([
      event.kind ? (event.category_id ?? "uncategorized") : "busy",
      color,
      manual ? (event.item_id ?? event.title) : "",
    ]);
    entries.set(id, {
      id,
      name: manual ? `${category} · ${event.title}（单独配色）` : category,
      color,
    });
  }
  return [...entries.values()];
}
export function calendarContrast(color: string) {
  const components = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * components[0]! + 0.7152 * components[1]! + 0.0722 * components[2]!;
  return (luminance + 0.05) / 0.0592 > 1.05 / (luminance + 0.05) ? "#111827" : "#ffffff";
}
