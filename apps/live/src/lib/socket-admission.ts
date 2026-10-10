/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { env } from "@/env";
import { redisManager } from "@/redis";
import { validOrigin } from "./auth";

const ADMIT = `
for i,key in ipairs(KEYS) do
  if tonumber(redis.call('GET',key) or '0') >= tonumber(ARGV[i]) then return 0 end
end
for i,key in ipairs(KEYS) do
  local n=redis.call('INCR',key)
  if n==1 then redis.call('EXPIRE',key,60) end
end
return 1
`;
const normalize = (address: string) => (address.startsWith("::ffff:") ? address.slice(7) : address);

export function socketSource(request: IncomingMessage) {
  const peer = normalize(request.socket.remoteAddress ?? "");
  const trusted = env.TRUSTED_PROXY_CIDRS.split(",")
    .map((entry) => entry.trim().split("/"))
    .some(
      ([address, prefix]) =>
        address && normalize(address) === peer && Number(prefix) === (isIP(address) === 4 ? 32 : 128)
    );
  if (trusted) {
    const value = request.headers["x-forwarded-for"];
    const forwarded = typeof value === "string" ? normalize(value.trim()) : "";
    if (isIP(forwarded)) return forwarded;
  }
  return isIP(peer) ? peer : "invalid";
}

/** Runs before the HTTP upgrade allocates Hocuspocus connections or queues. */
export const verifySocketHandshake: WebSocket.VerifyClientCallbackAsync = (info, done) => {
  if (!validOrigin(info.origin)) {
    done(false, 403, "Origin denied");
    return;
  }
  const source = createHash("sha256").update(socketSource(info.req)).digest("hex");
  const redis = redisManager.getClient();
  if (!redis) {
    done(false, 503, "Admission unavailable");
    return;
  }
  let finished = false;
  const complete: typeof done = (...result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done(...result);
  };
  const timer = setTimeout(() => complete(false, 503, "Admission unavailable"), 500);
  void Promise.resolve()
    .then(() =>
      redis.eval(
        ADMIT,
        2,
        "live:handshake:global",
        `live:handshake:source:${source}`,
        env.LIVE_HANDSHAKE_GLOBAL_LIMIT,
        env.LIVE_HANDSHAKE_SOURCE_LIMIT
      )
    )
    .then((accepted) => complete(Number(accepted) === 1, 429, "Handshake limit reached"))
    .catch(() => complete(false, 503, "Admission unavailable"));
};
