/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { AppError } from "./errors";

type Input = { description_html: string; variant: "rich" | "document" };
type Output = { description_json: unknown; description_binary: unknown };
type Job = {
  id: number;
  input: Input;
  resolve(value: Output): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};
type Slot = { worker: Worker; job?: Job };

/** Two interruptible workers and a bounded queue keep conversion off the HTTP event loop. */
export class ConversionPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private sequence = 0;
  submit(input: Input): Promise<Output> {
    if (this.queue.length >= 20) return Promise.reject(new AppError("Conversion queue full", { statusCode: 503 }));
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.sequence,
        input,
        resolve,
        reject,
        timer: setTimeout(() => this.expire(job), 10000),
      };
      this.queue.push(job);
      while (this.slots.length < 2) this.slots.push(this.spawn());
      this.drain();
    });
  }
  private spawn(): Slot {
    const root = dirname(createRequire(import.meta.url).resolve("live/package.json"));
    const worker = new Worker(join(root, "dist/document-conversion-worker.mjs"), {
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
    });
    const slot: Slot = { worker };
    worker.unref();
    worker.on("message", (message: { id: number; result?: Output; error?: boolean }) => {
      const job = slot.job;
      if (!job || message.id !== job.id) return;
      clearTimeout(job.timer);
      slot.job = undefined;
      worker.unref();
      if (message.error || !message.result) job.reject(new AppError("Document conversion failed", { statusCode: 400 }));
      else job.resolve(message.result);
      this.drain();
    });
    worker.on("error", () => this.failed(slot));
    worker.on("exit", () => {
      if (this.slots.includes(slot)) this.failed(slot);
    });
    return slot;
  }
  private failed(slot: Slot) {
    if (!this.slots.includes(slot)) return;
    if (slot.job) {
      clearTimeout(slot.job.timer);
      slot.job.reject(new AppError("Conversion worker unavailable", { statusCode: 503 }));
      slot.job = undefined;
    }
    this.slots.splice(this.slots.indexOf(slot), 1);
    void slot.worker.terminate();
    if (this.queue.length) {
      this.slots.push(this.spawn());
      this.drain();
    }
  }
  private expire(job: Job) {
    job.reject(new AppError("Document conversion timed out", { statusCode: 504 }));
    const queued = this.queue.indexOf(job);
    if (queued >= 0) this.queue.splice(queued, 1);
    const slot = this.slots.find((candidate) => candidate.job === job);
    if (slot) {
      slot.job = undefined;
      this.failed(slot);
    }
  }
  private drain() {
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      slot.job = this.queue.shift()!;
      slot.worker.ref();
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker messaging has no browser targetOrigin.
      slot.worker.postMessage({ id: slot.job.id, input: slot.job.input });
    }
  }
  async destroy() {
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(new AppError("Conversion stopped", { statusCode: 503 }));
    }
    await Promise.all(
      this.slots.splice(0).map((slot) => {
        if (slot.job) {
          clearTimeout(slot.job.timer);
          slot.job.reject(new AppError("Conversion stopped", { statusCode: 503 }));
        }
        return slot.worker.terminate();
      })
    );
  }
}
export const conversionPool = new ConversionPool();
