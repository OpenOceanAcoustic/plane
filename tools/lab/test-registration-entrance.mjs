// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";

// Read-only checks: use an unknown token and never create accounts or invitations.
const origin = process.env.LAB_REGISTRATION_BASE_URL ?? "http://127.0.0.1:8080";
const paths = ["/lab/register", "/lab/register/", "/lab/register/not-a-token", `/lab/register/${"A".repeat(43)}`];
await Promise.all(
  paths.flatMap((path) =>
    ["GET", "HEAD"].map(async (method) => {
      const response = await fetch(new URL(path, origin), { method, redirect: "manual" });
      assert.equal(response.status, 404, `${method}: unavailable registration pages must return HTTP 404`);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    })
  )
);
assert.equal((await fetch(origin)).status, 200, "Login must remain available");
console.log("Tokenless and unknown registration URLs return HTTP 404; login remains available");
