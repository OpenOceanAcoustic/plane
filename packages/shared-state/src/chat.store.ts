/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { makeAutoObservable, runInAction } from "mobx";
import type { ChatMessage, ChatMessagePage, ChatReferenceResults, ChatScope, ChatThread, TComment } from "@plane/types";
import { LabStore } from "./lab.store";

export class ChatStore {
  threads: ChatThread[] = [];
  thread: ChatThread | undefined;
  messages: ChatMessage[] = [];
  nextCursor: string | null = null;
  nextOffset: number | null = null;
  syncCursor: string | null = null;
  hasNewer = false;
  loading = false;
  error = "";
  private generation = 0;
  private mutation = 0;
  private refreshRequest = 0;
  private refreshing = false;
  private endCursor: string | null = null;
  private listGeneration = 0;
  private listQuery = "";
  private pending = new Map<string, string>();
  private transport: Pick<LabStore, "request">;

  constructor(
    apiBase: string,
    readonly slug: string,
    transport?: Pick<LabStore, "request">
  ) {
    this.transport = transport ?? new LabStore(apiBase, slug);
    makeAutoObservable(this, {}, { autoBind: true });
  }

  request<T>(path: string, method = "GET", body?: unknown) {
    return this.transport.request<T>(`chat/${path}`, method, body);
  }

  async loadThreads(query = this.listQuery, more = false) {
    this.listQuery = query;
    const generation = ++this.listGeneration;
    const data = await this.request<{ results: ChatThread[]; next_offset: number | null }>(
      `threads/?${new URLSearchParams({ q: query, offset: String(more ? (this.nextOffset ?? 0) : 0) })}`
    );
    runInAction(() => {
      if (generation !== this.listGeneration) return;
      this.threads = more
        ? [...this.threads.filter((row) => !data.results.some((next) => next.id === row.id)), ...data.results]
        : data.results;
      this.nextOffset = data.next_offset;
    });
  }

  resolve(scope: ChatScope, target_id?: string) {
    return this.request<ChatThread>("threads/", "POST", { scope, target_id });
  }

  async open(id: string, around?: string) {
    const generation = ++this.generation;
    this.thread = undefined;
    this.messages = [];
    this.loading = true;
    this.error = "";
    try {
      const [thread, page] = await Promise.all([
        this.request<ChatThread>(`threads/${id}/`),
        this.request<ChatMessagePage>(
          `threads/${id}/messages/${around ? `?around=${encodeURIComponent(around)}` : ""}`
        ),
      ]);
      runInAction(() => {
        if (generation !== this.generation) return;
        this.thread = thread;
        this.applyPage(page);
      });
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    } finally {
      runInAction(() => {
        if (generation === this.generation) this.loading = false;
      });
    }
  }

  private applyPage(page: ChatMessagePage) {
    this.messages = page.messages;
    this.nextCursor = page.next_cursor ?? null;
    this.syncCursor = page.sync_cursor;
    this.hasNewer = page.has_newer ?? false;
    this.endCursor = page.end_cursor ?? null;
  }

  async refresh() {
    const thread = this.thread;
    const generation = this.generation;
    const mutation = this.mutation;
    if (!thread || this.loading || this.refreshing) return;
    const refreshRequest = ++this.refreshRequest;
    this.refreshing = true;
    try {
      const query = new URLSearchParams();
      if (this.syncCursor) query.set("since", this.syncCursor);
      if (this.hasNewer && this.endCursor) query.set("until", this.endCursor);
      const page = await this.request<ChatMessagePage>(`threads/${thread.id}/messages/?${query}`);
      let continuation = page.continue_cursor;
      while (continuation) {
        if (generation !== this.generation || mutation !== this.mutation || refreshRequest !== this.refreshRequest)
          return;
        query.set("after", continuation);
        // oxlint-disable-next-line no-await-in-loop -- Each cursor depends on the preceding page.
        const next = await this.request<ChatMessagePage>(`threads/${thread.id}/messages/?${query}`);
        page.messages.push(...next.messages);
        continuation = next.continue_cursor;
      }
      if (generation !== this.generation || mutation !== this.mutation || refreshRequest !== this.refreshRequest)
        return;
      runInAction(() => {
        if (!this.syncCursor) this.applyPage(page);
        else this.messages = page.messages;
        if (page.can_write !== undefined && this.thread) this.thread.can_write = page.can_write;
        this.error = "";
      });
    } catch (error) {
      if (generation !== this.generation || refreshRequest !== this.refreshRequest) return;
      // A revoked scope must not leave cached messages on screen.
      try {
        await this.request(`threads/${thread.id}/`);
      } catch {
        runInAction(() => {
          if (generation !== this.generation || refreshRequest !== this.refreshRequest) return;
          this.messages = [];
          this.thread = undefined;
        });
      }
      if (generation === this.generation && refreshRequest === this.refreshRequest) this.fail(error);
    } finally {
      runInAction(() => {
        this.refreshing = false;
      });
    }
  }

  async older() {
    const id = this.thread?.id;
    const generation = this.generation;
    if (!id || !this.nextCursor) return;
    const page = await this.request<ChatMessagePage>(
      `threads/${id}/messages/?before=${encodeURIComponent(this.nextCursor)}`
    );
    runInAction(() => {
      if (generation !== this.generation) return;
      ++this.mutation;
      this.messages = [
        ...page.messages,
        ...this.messages.filter((row) => !page.messages.some((older) => older.id === row.id)),
      ];
      this.nextCursor = page.next_cursor ?? null;
      this.syncCursor = page.sync_cursor ?? this.syncCursor;
    });
  }

  async send(threadId: string, data: Partial<TComment>) {
    const body = JSON.stringify({ comment_html: data.comment_html, parent_id: data.parent_id });
    const identity = `${threadId}:${body}`;
    const key = this.pending.get(identity) ?? crypto.randomUUID();
    this.pending.set(identity, key);
    const result = await this.request<ChatMessage>(`threads/${threadId}/messages/`, "POST", {
      ...data,
      client_message_id: key,
    });
    runInAction(() => {
      ++this.mutation;
      this.pending.delete(identity);
      if (this.thread?.id === threadId && !this.messages.some((row) => row.id === result.id))
        this.messages = [...this.messages, result];
    });
    return result;
  }

  async edit(threadId: string, id: string, data: Partial<TComment>) {
    const result = await this.request<ChatMessage>(`threads/${threadId}/messages/${id}/`, "PATCH", data);
    runInAction(() => {
      ++this.mutation;
      if (this.thread?.id === threadId) this.messages = this.messages.map((row) => (row.id === id ? result : row));
    });
  }

  async remove(threadId: string, id: string) {
    await this.request(`threads/${threadId}/messages/${id}/`, "DELETE");
    runInAction(() => {
      ++this.mutation;
      if (this.thread?.id === threadId) this.messages = this.messages.filter((row) => row.id !== id);
    });
  }

  references(threadId: string, query: string) {
    return this.request<ChatReferenceResults>(`threads/${threadId}/references/?${new URLSearchParams({ q: query })}`);
  }

  async read(threadId: string, messageId: string) {
    const result = await this.request<{ unread_count: number }>(`threads/${threadId}/read/`, "POST", {
      message_id: messageId,
    });
    runInAction(() => {
      const row = this.threads.find((item) => item.id === threadId);
      if (row) row.unread_count = result.unread_count;
      if (this.thread?.id === threadId) this.thread.unread_count = result.unread_count;
    });
  }

  fail(error: unknown) {
    this.error = error instanceof Error ? error.message : "聊天读取失败，请重试";
  }
}
