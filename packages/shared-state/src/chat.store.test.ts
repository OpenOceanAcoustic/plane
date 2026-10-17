/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, ChatThread } from "@plane/types";
import { ChatStore } from "./chat.store";

const thread = { id: "room", scope: "workspace", can_write: true } as ChatThread;
const message = (id: string) => ({ id, thread_id: "room", comment_html: `<p>${id}</p>` }) as ChatMessage;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("late refresh cannot overwrite a successful send", async () => {
  const refresh = deferred<unknown>();
  const store = new ChatStore("", "test", {
    request: async <T>(_path: string, method = "GET") =>
      (method === "POST" ? message("sent") : await refresh.promise) as T,
  });
  store.thread = thread;
  store.syncCursor = "start";
  const pending = store.refresh();
  await store.send("room", { comment_html: "<p>sent</p>" });
  refresh.resolve({ messages: [], sync_cursor: "start" });
  await pending;
  assert.deepEqual(
    store.messages.map((row) => row.id),
    ["sent"]
  );
});

test("a slow refresh remains applicable when the next polling tick arrives", async () => {
  const response = deferred<unknown>();
  let requests = 0;
  const store = new ChatStore("", "test", {
    request: async <T>() => {
      requests++;
      return (await response.promise) as T;
    },
  });
  store.thread = thread;
  const first = store.refresh();
  await store.refresh();
  response.resolve({ messages: [message("slow")], sync_cursor: "start" });
  await first;
  assert.equal(requests, 1);
  assert.equal(store.messages[0]?.id, "slow");
});

test("failed sends retain their idempotency key and successful sends release it", async () => {
  const keys: string[] = [];
  const store = new ChatStore("", "test", {
    request: async <T>(_path: string, _method?: string, body?: unknown) => {
      keys.push((body as { client_message_id: string }).client_message_id);
      if (keys.length === 1) throw new Error("response lost");
      return message("one") as T;
    },
  });
  const data = { comment_html: "<p>hello</p>" };
  await assert.rejects(store.send("room", data));
  await store.send("room", data);
  await store.send("room", data);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("synchronization follows all pages without replacing the history cursor", async () => {
  const store = new ChatStore("", "test", {
    request: async <T>(path: string) =>
      (path.includes("after=")
        ? {
            messages: [message("second")],
            sync_cursor: "first",
            continue_cursor: null,
          }
        : { messages: [message("first")], sync_cursor: "first", continue_cursor: "next" }) as T,
  });
  store.thread = thread;
  store.syncCursor = "first";
  store.nextCursor = "older";
  await store.refresh();
  assert.deepEqual(
    store.messages.map((row) => row.id),
    ["first", "second"]
  );
  assert.equal(store.nextCursor, "older");
});

test("revoked historical conversations clear cached content", async () => {
  const store = new ChatStore("", "test", {
    request: async () => {
      throw new Error("会话不可访问");
    },
  });
  store.thread = thread;
  store.hasNewer = true;
  store.messages = [message("private")];
  await store.refresh();
  assert.equal(store.thread, undefined);
  assert.deepEqual(store.messages, []);
});

test("late responses from the previously selected conversation cannot overwrite the current one", async () => {
  const old = deferred<unknown>();
  const store = new ChatStore("", "test", {
    request: async <T>(path: string) => {
      if (path.includes("old")) return (await old.promise) as T;
      return (
        path.endsWith("messages/") ? { messages: [message("new")], sync_cursor: null } : { ...thread, id: "new" }
      ) as T;
    },
  });
  const opening = store.open("old");
  await store.open("new");
  old.resolve({ id: "old", messages: [message("old")], sync_cursor: null });
  await opening;
  assert.equal(store.thread?.id, "new");
  assert.equal(store.messages[0]?.id, "new");
});
