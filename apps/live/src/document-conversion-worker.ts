/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { parentPort } from "node:worker_threads";
import { convertHTMLDocumentToAllFormats } from "@plane/editor";
parentPort!.on(
  "message",
  ({ id, input }: { id: number; input: { description_html: string; variant: "rich" | "document" } }) => {
    try {
      const result = convertHTMLDocumentToAllFormats({ document_html: input.description_html, variant: input.variant });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node worker MessagePort has no browser targetOrigin.
      parentPort!.postMessage({ id, result });
    } catch {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node worker MessagePort has no browser targetOrigin.
      parentPort!.postMessage({ id, error: true });
    }
  }
);
