/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { calendarInstant, dropInstant, eventSegment, localInput, weekDays } from "./calendar-time";

test("calendar stays in Shanghai with Monday boundary independent of browser timezone", () => {
  const days = weekDays(0, new Date("2026-10-11T20:00:00Z"));
  assert.equal(days[0]!.toISOString(), "2026-10-11T16:00:00.000Z");
  assert.equal(localInput(days[0]!), "2026-10-12T00:00");
  assert.equal(calendarInstant("2026-10-12T09:15"), "2026-10-12T01:15:00.000Z");
});

test("drag snaps to fifteen minutes and remains within its day", () => {
  const day = new Date("2026-10-12T00:00:00+08:00");
  assert.equal(localInput(dropInstant(day, 0.391)), "2026-10-12T09:15");
  assert.equal(localInput(dropInstant(day, 1)), "2026-10-12T23:45");
});

test("overnight blocks render on both days without negative height", () => {
  const day = new Date("2026-10-12T00:00:00+08:00");
  const start = "2026-10-12T23:00:00+08:00",
    end = "2026-10-13T01:00:00+08:00";
  assert.deepEqual(eventSegment(start, end, day), { top: (23 / 24) * 100, height: (1 / 24) * 100 });
  assert.deepEqual(eventSegment(start, end, new Date(day.getTime() + 86400000)), { top: 0, height: (1 / 24) * 100 });
  assert.equal(eventSegment(start, end, new Date(day.getTime() - 86400000)), undefined);
});
