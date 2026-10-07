/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const SLOT_MS = 15 * 60 * 1000;
const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;

export function localInput(instant: string | Date): string {
  return new Date(new Date(instant).getTime() + SHANGHAI_OFFSET).toISOString().slice(0, 16);
}

export function calendarInstant(input: string): string {
  return new Date(`${input}:00+08:00`).toISOString();
}

export function weekDays(offset: number, now = new Date()): Date[] {
  const local = new Date(now.getTime() + SHANGHAI_OFFSET);
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - SHANGHAI_OFFSET);
  monday.setTime(monday.getTime() - ((local.getUTCDay() + 6) % 7) * 86400000 + offset * 7 * 86400000);
  return Array.from({ length: 7 }, (_, index) => new Date(monday.getTime() + index * 86400000));
}

export function dropInstant(day: Date, verticalFraction: number): Date {
  const slot = Math.max(0, Math.min(95, Math.floor(verticalFraction * 96)));
  return new Date(day.getTime() + slot * SLOT_MS);
}

export function eventSegment(start: string, end: string, day: Date): { top: number; height: number } | undefined {
  const clippedStart = Math.max(new Date(start).getTime(), day.getTime());
  const clippedEnd = Math.min(new Date(end).getTime(), day.getTime() + 86400000);
  if (clippedStart >= clippedEnd) return undefined;
  return {
    top: ((clippedStart - day.getTime()) / 86400000) * 100,
    height: ((clippedEnd - clippedStart) / 86400000) * 100,
  };
}

/** Give each connected group of overlapping events enough lanes to keep every block selectable. */
export function dayLayout<T extends { start: string; end: string }>(events: T[], day: Date) {
  const segments = events
    .flatMap((event) => {
      const segment = eventSegment(event.start, event.end, day);
      return segment ? [{ event, ...segment, lane: 0, lanes: 1 }] : [];
    })
    .toSorted((a, b) => a.top - b.top || b.height - a.height);
  let group: typeof segments = [];
  let laneEnds: number[] = [];
  const finishGroup = () => {
    for (const segment of group) segment.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const segment of segments) {
    if (laneEnds.length && segment.top >= Math.max(...laneEnds)) finishGroup();
    let lane = laneEnds.findIndex((end) => end <= segment.top);
    if (lane < 0) lane = laneEnds.length;
    segment.lane = lane;
    laneEnds[lane] = segment.top + segment.height;
    group.push(segment);
  }
  finishGroup();
  return segments;
}
