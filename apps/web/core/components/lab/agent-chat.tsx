/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import useSWR from "swr";
import { ArrowRight, Bot, Send, Sparkles, X } from "lucide-react";
import type { LabFinanceOverview } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, labInputClass } from "@plane/ui";
// oxlint-disable-next-line import/no-unassigned-import -- AI drawer styles
import "./agent-chat.css";

type ChatDraft =
  | {
      kind: "time";
      project_id: string;
      project_name: string;
      date: string;
      hours: string;
      work: string;
      user_id: string;
      user_name: string;
      rate: string;
      confidence: number;
    }
  | { kind: "work_item"; title: string; description: string };

type ChatResponse = {
  intent: "time_entry" | "work_item" | "query" | "needs_input" | "unsupported";
  reply: string;
  question: string;
  draft: ChatDraft | null;
  provider: string;
  model: string;
};

type ChatMessage = { id: string; role: "user" | "assistant"; text: string; draft?: ChatDraft; question?: string };

const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "你好，我可以帮你登记工时、记录工作项、查当前项目可用资金。发工资、入账、审批和权限变更会在第二批接入；现在这些请走对应表单。",
};

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function LabAgentChat({ store, workspaceSlug }: { store: LabStore; workspaceSlug: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const projects = useMemo(() => store.planner?.projects ?? [], [store.planner?.projects]);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const bottom = useRef<HTMLDivElement>(null);
  const { data: finance } = useSWR(
    ["lab-agent-finance", store.slug, projectId, open],
    () => (open && projectId ? store.request<LabFinanceOverview>(`finance/overview/?project_id=${projectId}`) : null),
    { keepPreviousData: true, shouldRetryOnError: false }
  );
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);
  const currentProject = projects.find((project) => project.id === projectId);
  const available = useMemo(
    () =>
      (finance?.accounts ?? [])
        .filter((account) => account.project_id === projectId && account.kind === "project")
        .reduce((total, account) => total + Number(account.available || 0), 0),
    [finance, projectId]
  );
  const context = useMemo(
    () => ({
      page: location.pathname,
      project_name: currentProject?.name ?? "",
      available_cash: finance && projectId ? available.toFixed(2) : null,
    }),
    [available, currentProject?.name, finance, location.pathname, projectId]
  );

  async function send(text = input) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setMessages((current) => [...current, { id: newId(), role: "user", text: message }]);
    setBusy(true);
    try {
      const response = await store.request<ChatResponse>("agent/chat/", "POST", {
        message,
        project_id: projectId,
        context,
      });
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: response.reply || response.question || "我没有生成结果。",
          draft: response.draft ?? undefined,
          question: response.intent === "needs_input" ? response.question : undefined,
        },
      ]);
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "AI 请求失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function openTimeDraft(draft: Extract<ChatDraft, { kind: "time" }>) {
    const encoded = encodeURIComponent(JSON.stringify(draft));
    navigate(
      `/${workspaceSlug}/lab/finance?finance_view=cost&project_id=${encodeURIComponent(draft.project_id)}&ai_time=${encoded}`
    );
    setOpen(false);
  }

  async function createWorkItem(draft: Extract<ChatDraft, { kind: "work_item" }>) {
    if (creating) return;
    setCreating(true);
    try {
      await store.request("items/", "POST", {
        title: draft.title,
        description: draft.description,
        category_id: null,
        folder_id: null,
        visibility: "private",
        shared_user_ids: [],
      });
      await store.execute(store.loadPlanner);
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: `已记录到个人规划：${draft.title}` },
      ]);
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "记录失败" },
      ]);
    } finally {
      setCreating(false);
    }
  }

  function chip(text: string) {
    setInput(`${text} `);
  }

  return (
    <>
      {!open && (
        <button type="button" className="lab-agent-fab" onClick={() => setOpen(true)} aria-label="打开 AI 助手">
          <Sparkles size={18} aria-hidden="true" />
          AI 助手
        </button>
      )}
      {open && (
        <section className="lab-agent-drawer" aria-label="AI 助手">
          <header className="lab-agent-head">
            <span className="lab-agent-mark" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div className="lab-agent-title">
              <strong>AI 助手</strong>
              <small>工时 / 工作项 / 可用资金</small>
            </div>
            <button type="button" className="lab-agent-close" onClick={() => setOpen(false)} aria-label="关闭 AI 助手">
              <X size={17} />
            </button>
          </header>
          {projects.length > 0 && (
            <label className="lab-agent-project">
              <span>项目</span>
              <select
                className={labInputClass}
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                aria-label="AI 项目"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="lab-agent-chips" aria-label="快捷指令">
            {["#工时", "#记录工作项", "#可用资金"].map((tag) => (
              <button key={tag} type="button" onClick={() => chip(tag)}>
                {tag}
              </button>
            ))}
          </div>
          <div className="lab-agent-messages" aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className="lab-agent-message" data-role={message.role}>
                <p>{message.text}</p>
                {message.question && <p className="lab-agent-question">{message.question}</p>}
                {message.draft?.kind === "time" && (
                  <div className="lab-agent-draft">
                    <strong>工时草稿</strong>
                    <dl>
                      <div>
                        <dt>项目</dt>
                        <dd>{message.draft.project_name}</dd>
                      </div>
                      <div>
                        <dt>日期</dt>
                        <dd>{message.draft.date}</dd>
                      </div>
                      <div>
                        <dt>工时</dt>
                        <dd>{message.draft.hours}</dd>
                      </div>
                      <div>
                        <dt>成员</dt>
                        <dd>{message.draft.user_name}</dd>
                      </div>
                      <div>
                        <dt>内容</dt>
                        <dd>{message.draft.work}</dd>
                      </div>
                      <div>
                        <dt>时薪</dt>
                        <dd>{message.draft.rate || "未识别，表单里补"}</dd>
                      </div>
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => openTimeDraft(message.draft as Extract<ChatDraft, { kind: "time" }>)}
                    >
                      填入工时表
                      <ArrowRight size={13} className="ml-1" />
                    </Button>
                  </div>
                )}
                {message.draft?.kind === "work_item" && (
                  <div className="lab-agent-draft">
                    <strong>工作项草稿</strong>
                    <p>{message.draft.title}</p>
                    {message.draft.description && <small>{message.draft.description}</small>}
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      loading={creating}
                      onClick={() => void createWorkItem(message.draft as Extract<ChatDraft, { kind: "work_item" }>)}
                    >
                      记录到个人规划
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="lab-agent-message" data-role="assistant">
                <p className="lab-agent-thinking">正在理解…</p>
              </div>
            )}
            <div ref={bottom} />
          </div>
          <form
            className="lab-agent-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              className={labInputClass}
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：今天在 APP内容设计 做了 3 小时，整理现金悬赏页面"
              aria-label="给 AI 助手发消息"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!input.trim()}>
              <Send size={14} className="mr-1" />
              发送
            </Button>
          </form>
        </section>
      )}
    </>
  );
}
