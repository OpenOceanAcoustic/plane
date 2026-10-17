/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "react-router";
import { ArrowLeft, MessageSquare, X } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { ChatStore } from "@plane/shared-state";
import type { ChatIssueReference, ChatThread, TComment, TCommentOperations } from "@plane/types";
import type { TMentionHandler } from "@plane/editor";
import { Avatar, Button, Input } from "@plane/ui";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import { copyUrlToClipboard, getFileURL } from "@plane/utils";
import { CommentsWrapper } from "@/components/comments/comments";
import type { CommentContextValue } from "@/components/comments/context";
import { CommentContext } from "@/components/comments/context";
import { CountChip } from "@/components/common/count-chip";
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
import { EditorMentionsRoot } from "@/components/editor/embeds/mentions";
import { IssueActivityLoader } from "@/components/issues/issue-detail/issue-activity/loader";
import { useWorkItemCommentOperations } from "@/components/issues/issue-detail/issue-activity/helper";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { ChatImageService } from "@/services/chat-image.service";
import type { LabOpenProjectIssue } from "./item-details";

const scopeNames = { workspace: "组织", project: "项目", issue: "工作项" };
const chatImageService = new ChatImageService();

export const LabChat = observer(function LabChat({ openProjectIssue }: { openProjectIssue?: LabOpenProjectIssue }) {
  const { workspaceSlug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const threadId = params.get("thread");
  const messageId = params.get("message") ?? undefined;
  const issueId = params.get("issue");
  const projectId = params.get("project");
  const store = useMemo(() => new ChatStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const [query, setQuery] = useState("");
  const drafts = useRef<Record<string, string>>({});
  const select = (id: string) => setParams({ thread: id });

  useEffect(() => {
    let live = true;
    if (threadId) void store.open(threadId, messageId);
    else if (issueId || projectId) {
      void store
        .resolve(issueId ? "issue" : "project", issueId ?? projectId!)
        .then((thread) => {
          if (live) setParams({ thread: thread.id }, { replace: true });
          return thread;
        })
        .catch(store.fail);
    }
    return () => {
      live = false;
    };
  }, [store, threadId, messageId, issueId, projectId, setParams]);

  useEffect(() => {
    const load = () => {
      if (document.visibilityState === "visible") void store.loadThreads(query).catch(store.fail);
    };
    const debounce = window.setTimeout(load, 250);
    const timer = window.setInterval(load, 30000);
    window.addEventListener("focus", load);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [query, store]);

  return (
    <main className="flex h-full min-h-0 flex-col bg-surface-1 text-primary" aria-label="聊天">
      <header className="flex items-center gap-2 border-b border-subtle px-6 py-4">
        <MessageSquare className="size-4" />
        <h1 className="text-18 font-semibold">聊天</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className={`${threadId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-subtle md:w-72`}
          aria-label="会话列表"
        >
          <div className="p-3">
            <Input
              aria-label="搜索会话或工作项"
              placeholder="搜索会话或工作项"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {store.threads.map((thread) => (
              <button
                type="button"
                key={thread.id}
                className="mb-1 block w-full text-left"
                onClick={() => select(thread.id)}
                aria-current={threadId === thread.id ? "true" : undefined}
              >
                <SidebarNavItem isActive={threadId === thread.id}>
                  <div className="min-w-0 flex-1 py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-13 font-medium">{thread.title}</span>
                      {thread.unread_count > 0 && <CountChip count={thread.unread_count} />}
                    </div>
                    <div className="mt-1 flex gap-2 text-11 text-tertiary">
                      <span>{scopeNames[thread.scope]}</span>
                      <span className="truncate">{thread.preview}</span>
                    </div>
                  </div>
                </SidebarNavItem>
              </button>
            ))}
            {store.nextOffset !== null && (
              <Button
                variant="neutral-primary"
                size="sm"
                onClick={() => void store.loadThreads(query, true).catch(store.fail)}
              >
                加载更多
              </Button>
            )}
            {store.threads.length === 0 && <p className="p-3 text-13 text-tertiary">暂无会话</p>}
          </div>
        </aside>
        <section
          className={`${threadId || issueId || projectId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col p-4`}
        >
          <div className="mb-2 md:hidden">
            <Button variant="neutral-primary" size="sm" onClick={() => setParams({})}>
              <ArrowLeft size={14} />
              返回会话
            </Button>
          </div>
          {store.error && (
            <div role="alert" className="mb-2 flex items-center gap-2 text-13 text-danger-primary">
              {store.error}
              <Button
                variant="neutral-primary"
                size="sm"
                onClick={() => (threadId ? void store.open(threadId) : void store.loadThreads(query).catch(store.fail))}
              >
                重试
              </Button>
            </div>
          )}
          {store.loading ? (
            <IssueActivityLoader />
          ) : threadId && store.thread ? (
            <ChatConversation
              key={store.thread.id}
              store={store}
              thread={store.thread}
              messageId={messageId}
              openProjectIssue={openProjectIssue}
              drafts={drafts.current}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyStateCompact assetKey="unknown" assetClassName="size-20" />
            </div>
          )}
        </section>
      </div>
    </main>
  );
});

const ChatConversation = observer(function ChatConversation({
  store,
  thread,
  messageId,
  openProjectIssue,
  drafts,
}: {
  store: ChatStore;
  thread: ChatThread;
  messageId?: string;
  openProjectIssue?: LabOpenProjectIssue;
  drafts: Record<string, string>;
}) {
  const [reply, setReply] = useState<TComment>();
  const [newMessages, setNewMessages] = useState(false);
  const [selectedReferences, setSelectedReferences] = useState<Record<string, ChatIssueReference>>({});
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const firstRender = useRef(true);
  const lastRead = useRef("");
  const previousLast = useRef("");
  const { commentReaction, peekIssue } = useIssueDetail();
  const legacyOperations = useWorkItemCommentOperations(
    store.slug,
    thread.project_id ?? undefined,
    thread.issue_id ?? undefined
  );
  const readVisible = useCallback(() => {
    const element = scroll.current;
    if (
      !element ||
      document.visibilityState !== "visible" ||
      !document.hasFocus() ||
      peekIssue ||
      document.querySelector('[role="dialog"][aria-modal="true"]')
    )
      return;
    const boundary = element.getBoundingClientRect();
    const nodes = element.querySelectorAll<HTMLElement>("[data-message-id]");
    let visible: string | undefined;
    for (let index = nodes.length - 1; index >= 0; index--) {
      const node = nodes.item(index);
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= boundary.bottom + 1 && rect.bottom > boundary.top) {
        visible = node.dataset.messageId;
        break;
      }
    }
    if (visible && visible !== lastRead.current) {
      lastRead.current = visible;
      void store.read(thread.id, visible).catch((error) => {
        lastRead.current = "";
        store.fail(error);
      });
    }
  }, [store, thread.id, peekIssue]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    const timer = window.setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [store]);

  useEffect(() => {
    if (thread.scope === "issue")
      store.messages.forEach((row) => commentReaction.applyCommentReactions(row.id, row.comment_reactions));
  }, [store.messages, thread.scope, commentReaction]);

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const latest = store.messages.at(-1)?.id ?? "";
    if (firstRender.current) {
      firstRender.current = false;
      const target = messageId
        ? element.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
        : null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.classList.add("bg-accent-primary/5");
        atBottom.current = false;
      } else element.scrollTop = element.scrollHeight;
    } else if (latest !== previousLast.current) {
      if (atBottom.current) element.scrollTop = element.scrollHeight;
      else setNewMessages(true);
    }
    previousLast.current = latest;
    const timer = window.setTimeout(readVisible, 150);
    return () => window.clearTimeout(timer);
  }, [store.messages, messageId, readVisible]);

  const operations: TCommentOperations = {
    ...(thread.scope === "issue"
      ? legacyOperations
      : {
          uploadCommentAsset: (_blockId: string, file: File) => chatImageService.upload(store.slug, thread.id, file),
          duplicateCommentAsset: (assetId: string) => chatImageService.duplicate(store.slug, thread.id, assetId),
        }),
    createComment: async (data) => {
      const sent = await store.send(thread.id, { ...data, parent_id: reply?.id });
      setReply(undefined);
      atBottom.current = true;
      void store.loadThreads().catch(store.fail);
      return sent;
    },
    updateComment: (id, data) => store.edit(thread.id, id, data),
    removeComment: async (id) => {
      try {
        await store.remove(thread.id, id);
      } catch (error) {
        store.fail(error);
      }
    },
    copyCommentLink: (id) => {
      void copyUrlToClipboard(`${window.location.origin}/${store.slug}/lab/chat?thread=${thread.id}&message=${id}`);
    },
  };
  const references = useMemo(
    () =>
      ({
        ...selectedReferences,
        ...Object.assign({}, ...store.messages.map((row) => row.references)),
      }) as Record<string, ChatIssueReference>,
    [selectedReferences, store.messages]
  );
  const mentionHandler = useMemo<TMentionHandler>(
    () => ({
      renderComponent: EditorMentionsRoot,
      getMentionedEntityDetails: (id) =>
        references[id]
          ? {
              display_name: references[id].accessible
                ? `${references[id].key} ${references[id].title}`
                : "工作项不可访问",
            }
          : undefined,
      searchCallback: async (query) => {
        const data = await store.references(thread.id, query);
        setSelectedReferences((previous) => ({
          ...previous,
          ...Object.fromEntries(data.issues.map((row) => [row.id, row])),
        }));
        return [
          {
            key: "users",
            title: "成员",
            items: data.users.map((user) => ({
              id: user.id,
              entity_identifier: user.id,
              entity_name: "user_mention" as const,
              title: user.display_name,
              icon: <Avatar name={user.display_name} src={getFileURL(user.avatar_url)} />,
            })),
          },
          {
            key: "issues",
            title: "工作项",
            items: data.issues.map((issue) => ({
              id: issue.id,
              entity_identifier: issue.id,
              entity_name: "issue" as const,
              title: `${issue.key} ${issue.title}`,
              icon: <MessageSquare size={14} />,
            })),
          },
        ];
      },
    }),
    [references, store, thread.id]
  );
  const context = useMemo<CommentContextValue>(
    () => ({
      mentionHandler,
      issueReferences: references,
      uploads: true,
      assetsManagedByMessage: thread.scope !== "issue",
      fileHandler:
        thread.scope !== "issue"
          ? {
              lifecycle: "message",
              getAssetSrc: async (assetId) => chatImageService.source(store.slug, thread.id, assetId),
              getAssetDownloadSrc: async (assetId) => chatImageService.source(store.slug, thread.id, assetId, true),
            }
          : undefined,
      onReply: thread.can_write ? setReply : undefined,
      draft: drafts[thread.id],
      onDraftChange: (value) => {
        drafts[thread.id] = value;
      },
      onOpenIssue: (reference) => {
        if (reference.project_id) openProjectIssue?.({ issue_id: reference.id, project_id: reference.project_id });
      },
    }),
    [mentionHandler, references, thread.scope, thread.can_write, thread.id, drafts, openProjectIssue, store.slug]
  );
  return (
    <CommentContext.Provider value={context}>
      <header className="mb-2 flex items-center gap-2 border-b border-subtle pb-3">
        <h2 className="truncate text-16 font-medium">{thread.title}</h2>
        <span className="text-12 text-tertiary">{scopeNames[thread.scope]}</span>
      </header>
      <CommentsWrapper
        entityId={thread.issue_id ?? thread.id}
        projectId={thread.project_id ?? undefined}
        comments={store.messages}
        activityOperations={operations}
        isEditingAllowed={thread.can_write}
        showCopyLinkOption
        enableReplies
        composerPosition="bottom"
        scrollRef={scroll}
        onScroll={() => {
          const node = scroll.current;
          if (node) {
            atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
            if (atBottom.current) setNewMessages(false);
          }
          readVisible();
        }}
        historyHeader={
          store.nextCursor && (
            <Button
              variant="neutral-primary"
              size="sm"
              onClick={async () => {
                const node = scroll.current;
                const height = node?.scrollHeight ?? 0;
                try {
                  await store.older();
                  requestAnimationFrame(() => {
                    if (node) node.scrollTop += node.scrollHeight - height;
                  });
                } catch (error) {
                  store.fail(error);
                }
              }}
            >
              加载更早消息
            </Button>
          )
        }
        composerHeader={
          <>
            {(newMessages || store.hasNewer) && (
              <Button
                variant="neutral-primary"
                size="sm"
                onClick={() => {
                  if (store.hasNewer) void store.open(thread.id);
                  else if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
                  atBottom.current = true;
                  setNewMessages(false);
                }}
              >
                查看新消息
              </Button>
            )}
            {reply && (
              <div className="mb-2 flex items-center gap-2 text-13 text-secondary">
                <span className="truncate">
                  回复 {reply.actor_detail?.display_name}：{reply.comment_stripped || "引用"}
                </span>
                <button type="button" aria-label="取消回复" onClick={() => setReply(undefined)}>
                  <X size={14} />
                </button>
              </div>
            )}
          </>
        }
        messagePrefix={(message) =>
          message.parent_id && (
            <button
              type="button"
              className="ml-10 text-12 text-secondary hover:text-accent-primary"
              onClick={() => {
                const parent = scroll.current?.querySelector<HTMLElement>(
                  `[data-message-id="${CSS.escape(message.parent_id!)}"]`
                );
                if (parent) parent.scrollIntoView({ block: "center" });
                else void store.open(thread.id, message.parent_id!);
              }}
            >
              回复 {store.messages.find((row) => row.id === message.parent_id)?.actor_detail?.display_name ?? "消息"}
            </button>
          )
        }
      />
    </CommentContext.Provider>
  );
});
