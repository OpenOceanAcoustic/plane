/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { Hocuspocus } from "@hocuspocus/server";
import { AppError } from "./errors";

/** Bound before API calls or binary decoding; state lives only while a user is connected. */
export class CollaborationLimits {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private users = new Map<string, { connections: Set<string>; messages: number[] }>();
  available(userId: string) {
    return (this.users.get(userId)?.connections.size ?? 0) < 8;
  }
  reserve(userId: string, key: string) {
    const user = this.users.get(userId) ?? { connections: new Set<string>(), messages: [] };
    if (!user.connections.has(key) && user.connections.size >= 8) throw new AppError("Connection limit reached");
    user.connections.add(key);
    this.users.set(userId, user);
    const timer = setTimeout(() => this.release(userId, key), 10000);
    timer.unref();
    this.pending.set(key, timer);
  }
  established(key: string) {
    const timer = this.pending.get(key);
    if (timer) clearTimeout(timer);
    this.pending.delete(key);
  }
  release(userId: string, key: string) {
    this.established(key);
    const user = this.users.get(userId);
    user?.connections.delete(key);
    if (!user?.connections.size) this.users.delete(userId);
  }
  message(userId: string, size: number) {
    if (size > 8 * 1024 * 1024) throw new AppError("Message too large");
    const user = this.users.get(userId);
    if (!user) throw new AppError("Connection is not authorized");
    const now = Date.now();
    user.messages = user.messages.filter((at) => at > now - 1000);
    if (user.messages.length >= 20) throw new AppError("Message rate exceeded");
    user.messages.push(now);
  }
}
const limits = new WeakMap<Hocuspocus, CollaborationLimits>();
export function collaborationLimits(server: Hocuspocus) {
  let result = limits.get(server);
  if (!result) {
    result = new CollaborationLimits();
    limits.set(server, result);
  }
  return result;
}
