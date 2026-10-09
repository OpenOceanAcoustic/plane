/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { WebSocket } from "ws";
import { AppError } from "./errors";

const MAX_BYTES = 8 * 1024 * 1024;
// A burst of admitted sockets must not multiply the retained queue to gigabytes.
const MAX_PENDING_BYTES = 64 * 1024 * 1024;
let totalPendingBytes = 0;

/** Bound the protocol before Hocuspocus queues or decodes document updates. */
export class SocketTransport {
  private messages: number[] = [];
  private pending = new Map<string, number>();
  private established = new Set<string>();
  private pendingBytes = 0;

  accept(data: Uint8Array) {
    const now = Date.now();
    this.messages = this.messages.filter((at) => at > now - 1000);
    if (this.messages.length >= 20 || data.byteLength > MAX_BYTES) throw new AppError("Socket budget exceeded");
    this.messages.push(now);
    // Hocuspocus prefixes every frame with a varstring document name. Supported
    // UUID names have a one-byte length, so reject larger headers without decoding.
    if (data[0] !== 36 || data.byteLength < 37) throw new AppError("Invalid document frame");
    const name = Buffer.from(data.buffer, data.byteOffset + 1, 36).toString("utf8");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name))
      throw new AppError("Invalid document frame");
    if (this.established.has(name)) return;
    if (
      (!this.pending.has(name) && this.pending.size >= 8) ||
      this.pendingBytes + data.byteLength > MAX_BYTES ||
      totalPendingBytes + data.byteLength > MAX_PENDING_BYTES
    )
      throw new AppError("Pending document budget exceeded");
    this.pending.set(name, (this.pending.get(name) ?? 0) + data.byteLength);
    this.pendingBytes += data.byteLength;
    totalPendingBytes += data.byteLength;
  }
  ready(name: string) {
    this.pendingBytes -= this.pending.get(name) ?? 0;
    totalPendingBytes -= this.pending.get(name) ?? 0;
    this.pending.delete(name);
    this.established.add(name);
  }
  remove(name: string) {
    this.pendingBytes -= this.pending.get(name) ?? 0;
    totalPendingBytes -= this.pending.get(name) ?? 0;
    this.pending.delete(name);
    this.established.delete(name);
  }
  close() {
    totalPendingBytes -= this.pendingBytes;
    this.pendingBytes = 0;
    this.pending.clear();
    this.established.clear();
  }
}

export function protectSocketTransport(socket: WebSocket, transport: SocketTransport) {
  // Hocuspocus owns a message listener. Interpose before invoking that listener,
  // rather than prependListener (which would still forward a rejected frame).
  const handlers = socket.listeners("message");
  socket.removeAllListeners("message");
  const received = new WeakSet<Buffer>();
  socket.once("close", () => transport.close());
  let rejected = false;
  socket.on("message", (raw: Buffer, binary: boolean) => {
    if (rejected) return;
    try {
      if (!received.has(raw)) {
        transport.accept(raw);
        received.add(raw);
      }
    } catch {
      rejected = true;
      socket.close(4003, "Socket budget exceeded");
      return;
    }
    for (const handler of handlers) handler.call(socket, raw, binary);
  });
}
