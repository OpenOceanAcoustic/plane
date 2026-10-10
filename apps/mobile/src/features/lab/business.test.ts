/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { test } from "vitest";
import assert from "node:assert/strict";
import { scheduleMutation, contributionQuery } from "./business";

test("saving an existing schedule includes the revision captured at opening", () => {
  assert.deepEqual(scheduleMutation({ id: "block", revision: 7 }, "2026-10-10T09:00", "2026-10-10T10:00"), {
    expected_revision: 7,
    start: "2026-10-10T01:00:00.000Z",
    end: "2026-10-10T02:00:00.000Z",
  });
});
test("contribution pagination retains the selected project and day", () => {
  assert.equal(
    contributionQuery("2026-10", "p1", "2026-10-10", "next+cursor").toString(),
    "month=2026-10&project_id=p1&day=2026-10-10&cursor=next%2Bcursor"
  );
});
