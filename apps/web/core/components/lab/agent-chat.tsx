/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  | { kind: "work_item"; title: string; description: string }
  | { kind: "receipt"; gross: string; tax: string; management_fee: string; source: string; stage_id: string }
  | { kind: "payroll"; user_id: string; user_name: string; start: string; end: string }
  | { kind: "quality"; title: string; description: string }
  | { kind: "participation"; action: string; user_id: string; user_name: string; note: string }
  | {
      kind: "project_issue";
      title: string;
      description: string;
      acceptance: string;
      assignee_id: string;
      assignee_name: string;
      due_date: string;
      priority: string;
    }
  | {
      kind: "project_create";
      name: string;
      start_date: string;
      target_date: string;
      all_members: boolean;
      member_ids: string[];
      member_names: string[];
      budget: string;
      description: string;
    }
  | {
      kind: "project_lead";
      target_user_id: string;
      target_name: string;
      current_lead_name: string;
      reason: string;
    }
  | {
      kind: "project_plan";
      summary: string;
      stages: {
        title: string;
        description: string;
        start_date: string;
        target_date: string;
        tasks: {
          title: string;
          description: string;
          acceptance: string;
          assignee_name: string;
          due_date: string;
          priority: string;
        }[];
      }[];
      risks: string[];
      assumptions: string[];
    };

type ChatResponse = {
  intent: "time_entry" | "work_item" | "query" | "needs_input" | "unsupported" | "tool";
  tool?: "brief" | "retro" | "quality" | "team" | "knowledge" | "finance" | "";
  tool_args?: { period?: string; query?: string };
  reply: string;
  question: string;
  draft: ChatDraft | null;
  provider: string;
  model: string;
  thread_id?: string;
};

type AgentThread = {
  id: string;
  title: string;
  project_id: string | null;
  project_name: string;
  last_message_at: string | null;
};

type AgentBriefIssue = { id: string; key: string; title: string; assignees: string[]; due: string; state: string };

type AgentBrief = {
  period: "daily" | "weekly";
  generated_at: string;
  project: { id: string; name: string };
  counts: {
    active: number;
    completed: number;
    in_progress: number;
    overdue: number;
    due_today: number;
    due_next: number;
    unassigned: number;
  };
  completed: AgentBriefIssue[];
  in_progress: AgentBriefIssue[];
  overdue: AgentBriefIssue[];
  due_today: AgentBriefIssue[];
  due_next: AgentBriefIssue[];
  unassigned: AgentBriefIssue[];
  team: { name: string; active: number }[];
  finance: { summary?: Record<string, string> | null; available?: string };
  risks: string[];
  summary: string;
};

type AgentReminder = {
  id: string;
  kind: "daily_brief" | "weekly_brief" | "payroll";
  enabled: boolean;
  hour: number;
  weekday: number | null;
  day_of_month: number | null;
  project_id: string;
};

type AgentRetroSuggestion = { title: string; description: string; acceptance: string; priority: string };

type AgentRetro = {
  period: "week" | "month";
  generated_at: string;
  start_date: string;
  project: { id: string; name: string };
  counts: { completed: number; cancelled: number; rolled: number; overdue: number; unassigned: number };
  completed: AgentBriefIssue[];
  cancelled: AgentBriefIssue[];
  rolled: AgentBriefIssue[];
  overdue: AgentBriefIssue[];
  unassigned: AgentBriefIssue[];
  team: { name: string; active: number; completed: number }[];
  finance: { summary?: Record<string, string> | null; available?: string };
  suggestions: AgentRetroSuggestion[];
};

type AgentQualityGap = { key?: string; id?: string; label?: string; title?: string; stage?: string; state?: string };

type AgentQuality = {
  project: { id: string; name: string };
  counts: { records: number; current: number; stale: number; missing: number; pending: number };
  missing: AgentQualityGap[];
  stale: AgentQualityGap[];
  pending: AgentQualityGap[];
  suggestions: { title: string; description: string; acceptance: string }[];
};

type AgentTeam = {
  project: { id: string; name: string };
  members: { id: string; name: string; role: string; active: number; overdue: number; completed: number }[];
  unassigned: AgentBriefIssue[];
  overloaded: { id: string; name: string; active: number; overdue: number; completed: number }[];
  suggestions: { title: string; description: string; assignee_id: string; assignee_name: string; acceptance: string }[];
  average_active: number;
};

type AgentKnowledge = {
  query: string;
  count: number;
  answer: string;
  results: { id: string; title: string; snippet: string; updated_at: string; url: string }[];
};

type AgentFinance = {
  project: { id: string; name: string };
  can_view_finance: boolean;
  summary: Record<string, string> | null;
  categories: { category: string; label: string; budget: string; cost: string; remaining: string }[];
  cashflow: { received: string; paid: string; net: string } | null;
  anomalies: { kind: string; title: string; detail: string }[];
  suggestions: { title: string; description: string; acceptance: string }[];
};

type AgentMeetingTask = {
  title: string;
  description: string;
  assignee_id: string;
  assignee_name: string;
  due_date: string;
  priority: string;
  acceptance: string;
};

type AgentMeeting = {
  summary: string;
  decisions: string[];
  risks: string[];
  tasks: AgentMeetingTask[];
};

type AgentLeadRequest = {
  id: string;
  project_id: string;
  requested_by: string;
  target_user_id: string;
  target_name: string;
  reason: string;
  status: string;
  reviewed_by: string;
  reviewed_at: string | null;
  can_review: boolean;
};

type AgentProposal = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  created_by: string;
  created_at: string;
  approvals: {
    lead: { at: string | null; by: string };
    member: { at: string | null; by: string };
    technical: { at: string | null; by: string };
  };
};

type AgentThreadDetail = AgentThread & {
  messages: { id: string; role: "user" | "assistant"; content: string; intent?: string; draft?: unknown }[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  draft?: ChatDraft;
  question?: string;
  link?: { href: string; label: string };
  brief?: AgentBrief;
  retro?: AgentRetro;
  quality?: AgentQuality;
  team?: AgentTeam;
  knowledge?: AgentKnowledge;
  finance?: AgentFinance;
  meeting?: AgentMeeting;
  proposal?: AgentProposal;
  leadRequest?: AgentLeadRequest;
  proposals?: AgentProposal[];
};

const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "你好，我可以帮你登记工时、记录工作项、查当前项目可用资金。发工资、入账、审批和权限变更会在第二批接入；现在这些请走对应表单。",
};

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function storedMessage(item: AgentThreadDetail["messages"][number]): ChatMessage {
  const draft = item.draft as { kind?: string; data?: unknown } | null | undefined;
  const base: ChatMessage = { id: item.id, role: item.role, text: item.content };
  if (draft?.kind && "data" in draft) {
    switch (draft.kind) {
      case "brief":
        return { ...base, brief: draft.data as AgentBrief };
      case "retro":
        return { ...base, retro: draft.data as AgentRetro };
      case "quality":
        return { ...base, quality: draft.data as AgentQuality };
      case "team":
        return { ...base, team: draft.data as AgentTeam };
      case "knowledge":
        return { ...base, knowledge: draft.data as AgentKnowledge };
      case "finance":
        return { ...base, finance: draft.data as AgentFinance };
      case "meeting":
        return { ...base, meeting: draft.data as AgentMeeting };
      case "proposal":
        return { ...base, proposal: draft.data as AgentProposal };
      case "proposals":
        return { ...base, proposals: draft.data as AgentProposal[] };
      default:
        break;
    }
  }
  return { ...base, draft: item.draft as ChatDraft | undefined };
}

function ProposalCard({
  proposal,
  busy,
  onApprove,
}: {
  proposal: AgentProposal;
  busy: string;
  onApprove: (proposal: AgentProposal, role: "lead" | "member" | "technical") => Promise<void>;
}) {
  const roles: { key: "lead" | "member" | "technical"; label: string }[] = [
    { key: "lead", label: "负责人" },
    { key: "member", label: "成员" },
    { key: "technical", label: "技术/财务" },
  ];
  return (
    <div className="lab-agent-proposal">
      <strong>{proposal.title}</strong>
      {proposal.description && <p>{proposal.description}</p>}
      <small>
        {proposal.created_by} · {proposal.status === "approved" ? "已通过" : "评审中"}
      </small>
      <div className="lab-agent-proposal-approvals">
        {roles.map((role) => (
          <button
            key={role.key}
            type="button"
            disabled={!!busy || !!proposal.approvals[role.key].at}
            onClick={() => void onApprove(proposal, role.key)}
          >
            {proposal.approvals[role.key].at ? `${role.label}已确认` : `${role.label}确认`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LabAgentChat({
  store,
  workspaceSlug,
  fullPage = false,
}: {
  store: LabStore;
  workspaceSlug: string;
  fullPage?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const projects = useMemo(() => store.planner?.projects ?? [], [store.planner?.projects]);
  const [open, setOpen] = useState(fullPage);
  const [expanded, setExpanded] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [importingPlan, setImportingPlan] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [threadId, setThreadId] = useState("");
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [reminders, setReminders] = useState<AgentReminder[]>([]);
  const [showReminders, setShowReminders] = useState(false);
  const [savingReminders, setSavingReminders] = useState(false);
  const [publishingSuggestion, setPublishingSuggestion] = useState("");
  const [publishingMeetingTask, setPublishingMeetingTask] = useState("");
  const [reviewingProposal, setReviewingProposal] = useState("");
  const [reviewingLead, setReviewingLead] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const loadedThreads = useRef(false);
  const { data: finance, error: financeError } = useSWR(
    ["lab-agent-finance", store.slug, projectId, open],
    () => (open && projectId ? store.request<LabFinanceOverview>(`finance/overview/?project_id=${projectId}`) : null),
    { shouldRetryOnError: false }
  );
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    if (!open) return;
    void store.execute(store.loadPlanner);
  }, [open, store]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);
  const currentProject = projects.find((project) => project.id === projectId);
  const available = useMemo(
    () =>
      (finance?.accounts ?? [])
        .filter((account) => account.project_id === projectId)
        .reduce((total, account) => total + Number(account.available || 0), 0),
    [finance, projectId]
  );
  const projectCash = useMemo(
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
      available_total: finance && !financeError && projectId ? available.toFixed(2) : null,
      project_cash: finance && !financeError && projectId ? projectCash.toFixed(2) : null,
    }),
    [available, currentProject?.name, finance, financeError, location.pathname, projectCash, projectId]
  );

  const refreshThreads = useCallback(async () => {
    const rows = await store.request<AgentThread[]>("agent/threads/");
    setThreads(rows);
    return rows;
  }, [store]);

  const refreshReminders = useCallback(async () => {
    if (!projectId) return;
    const rows = await store.request<AgentReminder[]>(`agent/reminders/?project_id=${encodeURIComponent(projectId)}`);
    setReminders(rows);
  }, [projectId, store]);

  async function persistSpecial(content: string, draft: Record<string, unknown>) {
    if (!threadId) return;
    try {
      await store.request("agent/messages/", "POST", { thread_id: threadId, content, draft });
    } catch {
      // Persistence should not block the card the user just requested.
    }
  }

  const loadThread = useCallback(
    async (id: string) => {
      if (!id) {
        setThreadId("");
        setMessages([welcome]);
        return;
      }
      try {
        const detail = await store.request<AgentThreadDetail>(`agent/threads/${id}/`);
        setThreadId(id);
        if (detail.project_id) setProjectId(detail.project_id);
        setMessages(detail.messages.length ? detail.messages.map(storedMessage) : [welcome]);
      } catch (problem) {
        setMessages((current) => [
          ...current,
          { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "读取会话失败" },
        ]);
      }
    },
    [store]
  );

  useEffect(() => {
    if (!open || !projectId) return;
    void refreshReminders().catch(() => undefined);
  }, [open, projectId, refreshReminders]);

  useEffect(() => {
    if (!open || loadedThreads.current) return;
    loadedThreads.current = true;
    void (async () => {
      try {
        const rows = await refreshThreads();
        if (rows[0]) await loadThread(rows[0].id);
      } catch {
        // A failed history load should not block a new chat.
      }
    })();
  }, [open, loadThread, refreshThreads]);

  async function saveReminders() {
    if (!projectId || savingReminders) return;
    setSavingReminders(true);
    try {
      const values: {
        kind: AgentReminder["kind"];
        hour: number;
        weekday: number | null;
        day_of_month: number | null;
      }[] = [
        { kind: "daily_brief", hour: 8, weekday: null, day_of_month: null },
        { kind: "weekly_brief", hour: 8, weekday: 1, day_of_month: null },
        { kind: "payroll", hour: 9, weekday: null, day_of_month: 25 },
      ];
      const payloads = values.map((value) => {
        const current = reminders.find((item) => item.kind === value.kind);
        return {
          project_id: projectId,
          kind: value.kind,
          enabled: current?.enabled ?? false,
          hour: value.hour,
          weekday: value.weekday,
          day_of_month: value.day_of_month,
        };
      });
      await Promise.all(payloads.map((payload) => store.request("agent/reminders/", "POST", payload)));
      await refreshReminders();
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "提醒设置已保存。到点后会在「项目提醒」会话里生成只读简报。" },
      ]);
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "保存提醒失败" },
      ]);
    } finally {
      setSavingReminders(false);
    }
  }

  async function send(text = input) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setMessages((current) => [...current, { id: newId(), role: "user", text: message }]);
    const proposalMatch = message.match(/^提案[：:]\s*([\s\S]*)$/);
    if (proposalMatch) {
      await submitProposal(proposalMatch[1] || "");
      return;
    }
    const meetingMatch = message.match(/^(?:会议纪要|纪要)[：:]\s*([\s\S]*)$/);
    if (meetingMatch) {
      await loadMeeting(meetingMatch[1] || "");
      return;
    }
    const knowledgeMatch = message.match(/^查知识库[：:\s]*(.*)$/);
    if (knowledgeMatch) {
      await loadKnowledge(knowledgeMatch[1] || "");
      return;
    }
    setBusy(true);
    try {
      const response = await store.request<ChatResponse>("agent/chat/", "POST", {
        message,
        project_id: projectId,
        thread_id: threadId || undefined,
        context,
      });
      if (response.thread_id) {
        setThreadId(response.thread_id);
        void refreshThreads();
      }
      if (response.tool === "brief") {
        await loadBrief(response.tool_args?.period === "weekly" ? "weekly" : "daily");
        return;
      }
      if (response.tool === "retro") {
        await loadRetro(response.tool_args?.period === "month" ? "month" : "week");
        return;
      }
      if (response.tool === "knowledge") {
        await loadKnowledge(response.tool_args?.query || "");
        return;
      }
      if (response.tool === "quality") {
        await loadQuality();
        return;
      }
      if (response.tool === "team") {
        await loadTeam();
        return;
      }
      if (response.tool === "finance") {
        await loadFinance();
        return;
      }
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

  function openFinanceDraft(kind: "receipt" | "payroll", draft: ChatDraft) {
    const encoded = encodeURIComponent(JSON.stringify(draft));
    const view = kind === "receipt" ? "income" : "payroll";
    navigate(
      `/${workspaceSlug}/lab/finance?finance_view=${view}&project_id=${encodeURIComponent(projectId)}&ai_${kind}=${encoded}`
    );
    setOpen(false);
  }

  async function submitLeadRequest(draft: Extract<ChatDraft, { kind: "project_lead" }>) {
    if (reviewingLead) return;
    setReviewingLead("submit");
    try {
      const request = await store.request<AgentLeadRequest>("agent/lead-requests/", "POST", {
        project_id: projectId,
        target_user_id: draft.target_user_id,
        reason: draft.reason,
      });
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: "项目负责人变更已提交，等待项目管理员审核。",
          leadRequest: request,
        },
      ]);
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "提交负责人变更失败" },
      ]);
    } finally {
      setReviewingLead("");
    }
  }

  async function reviewLeadRequest(request: AgentLeadRequest, approve: boolean) {
    if (reviewingLead) return;
    setReviewingLead(`${request.id}-${approve ? "yes" : "no"}`);
    try {
      const updated = await store.request<AgentLeadRequest>(`agent/lead-requests/${request.id}/review/`, "POST", {
        approve,
      });
      setMessages((current) =>
        current.map((message) =>
          message.leadRequest?.id === updated.id ? { ...message, leadRequest: updated } : message
        )
      );
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "审核负责人变更失败" },
      ]);
    } finally {
      setReviewingLead("");
    }
  }

  async function submitProposal(text: string) {
    if (!projectId) {
      setMessages((current) => [...current, { id: newId(), role: "assistant", text: "请先选择项目，再提交提案。" }]);
      return;
    }
    const raw = text.replace(/^提案[：:]\s*/, "").trim();
    if (!raw) {
      setMessages((current) => [...current, { id: newId(), role: "assistant", text: "请写成：提案：标题 | 说明" }]);
      return;
    }
    const [title, ...rest] = raw.split("|");
    setBusy(true);
    try {
      const proposal = await store.request<AgentProposal>("agent/proposals/", "POST", {
        project_id: projectId,
        title: title.trim(),
        description: rest.join("|").trim(),
        category: "process",
      });
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: "提案已提交三结合评审。需要负责人、成员、技术/财务三方分别确认。",
          proposal,
        },
      ]);
      void persistSpecial("已提交三结合评审", { kind: "proposal", data: proposal });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "提交提案失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function loadProposals() {
    if (!projectId) {
      setMessages((current) => [...current, { id: newId(), role: "assistant", text: "请先选择项目，再查看评审。" }]);
      return;
    }
    setBusy(true);
    try {
      const proposals = await store.request<AgentProposal[]>(
        `agent/proposals/?project_id=${encodeURIComponent(projectId)}`
      );
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `当前项目有 ${proposals.length} 条提案。`,
          proposals,
        },
      ]);
      void persistSpecial(`当前项目有 ${proposals.length} 条提案`, { kind: "proposals", data: proposals });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "读取评审失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function approveProposal(proposal: AgentProposal, role: "lead" | "member" | "technical") {
    if (reviewingProposal) return;
    setReviewingProposal(`${proposal.id}-${role}`);
    try {
      const updated = await store.request<AgentProposal>(`agent/proposals/${proposal.id}/approve/`, "POST", { role });
      setMessages((current) =>
        current.map((message) => {
          if (message.proposal?.id === updated.id) return { ...message, proposal: updated };
          if (message.proposals) {
            return {
              ...message,
              proposals: message.proposals.map((item) => (item.id === updated.id ? updated : item)),
            };
          }
          return message;
        })
      );
      void persistSpecial("提案状态已更新", { kind: "proposal", data: updated });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "评审失败" },
      ]);
    } finally {
      setReviewingProposal("");
    }
  }

  async function loadMeeting(text: string) {
    if (!projectId) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请先选择项目，再整理会议纪要。" },
      ]);
      return;
    }
    if (text.trim().length < 10) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请粘贴至少 10 个字的会议纪要。" },
      ]);
      return;
    }
    setBusy(true);
    try {
      const meeting = await store.request<AgentMeeting>("agent/meeting/", "POST", {
        project_id: projectId,
        text: text.trim(),
      });
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `会议纪要已整理：${meeting.decisions.length} 项决策，${meeting.tasks.length} 个任务，${meeting.risks.length} 个风险。`,
          meeting,
        },
      ]);
      void persistSpecial(`会议纪要：${meeting.tasks.length} 个任务`, { kind: "meeting", data: meeting });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "整理会议纪要失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function publishMeetingTask(task: AgentMeetingTask) {
    if (publishingMeetingTask) return;
    setPublishingMeetingTask(task.title);
    try {
      const issue = await store.request<{ id: string; key: string; title: string; url: string }>(
        "agent/project-issue/",
        "POST",
        {
          project_id: projectId,
          thread_id: threadId || undefined,
          title: task.title,
          description: task.description,
          acceptance: task.acceptance,
          assignee_id: task.assignee_id || undefined,
          due_date: task.due_date || undefined,
          priority: task.priority,
        }
      );
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `已从会议纪要创建工作项：${issue.title}（${issue.key}）`,
          link: { href: issue.url, label: "打开工作项" },
        },
      ]);
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "创建会议任务失败" },
      ]);
    } finally {
      setPublishingMeetingTask("");
    }
  }

  async function loadFinance() {
    if (!projectId) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请先选择项目，再查看财务概览。" },
      ]);
      return;
    }
    setBusy(true);
    try {
      const financeData = await store.request<AgentFinance>(
        `agent/finance/?project_id=${encodeURIComponent(projectId)}`
      );
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: financeData.can_view_finance
            ? `财务概览：预算 ¥${financeData.summary?.budget ?? "0"}，已发生 ¥${financeData.summary?.cost ?? "0"}，剩余 ¥${financeData.summary?.remaining ?? "0"}，异常 ${financeData.anomalies.length} 项。`
            : "你没有查看财务的权限。",
          finance: financeData,
        },
      ]);
      void persistSpecial("财务概览", { kind: "finance", data: financeData });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "读取财务概览失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function loadKnowledge(query: string) {
    if (!projectId) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请先选择项目，再查询项目知识库。" },
      ]);
      return;
    }
    if (query.trim().length < 2) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请至少输入 2 个字，例如：查知识库：验收标准" },
      ]);
      return;
    }
    setBusy(true);
    try {
      const knowledge = await store.request<AgentKnowledge>(
        `agent/knowledge/?project_id=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query.trim())}`
      );
      setMessages((current) => [...current, { id: newId(), role: "assistant", text: knowledge.answer, knowledge }]);
      void persistSpecial(knowledge.answer, { kind: "knowledge", data: knowledge });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "查询知识库失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function loadTeam() {
    if (!projectId) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请先选择项目，再查看团队负载。" },
      ]);
      return;
    }
    setBusy(true);
    try {
      const team = await store.request<AgentTeam>(`agent/team/?project_id=${encodeURIComponent(projectId)}`);
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `团队负载：平均 ${team.average_active} 个进行中，超载 ${team.overloaded.length} 人，无人负责 ${team.unassigned.length} 个。`,
          team,
        },
      ]);
      void persistSpecial(`团队负载：平均 ${team.average_active}`, { kind: "team", data: team });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "读取团队负载失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function loadQuality() {
    if (!projectId) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请先选择项目，再查看质量反馈。" },
      ]);
      return;
    }
    setBusy(true);
    try {
      const quality = await store.request<AgentQuality>(`agent/quality/?project_id=${encodeURIComponent(projectId)}`);
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `质量反馈：缺失 ${quality.counts.missing}，失效 ${quality.counts.stale}，待审 ${quality.counts.pending}。`,
          quality,
        },
      ]);
      void persistSpecial(`质量反馈：缺失 ${quality.counts.missing}`, { kind: "quality", data: quality });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "读取质量反馈失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function loadRetro(period: "week" | "month") {
    if (!projectId) {
      setMessages((current) => [...current, { id: newId(), role: "assistant", text: "请先选择项目，再查看复盘。" }]);
      return;
    }
    setBusy(true);
    try {
      const retro = await store.request<AgentRetro>(
        `agent/retro/?project_id=${encodeURIComponent(projectId)}&period=${period}`
      );
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `${period === "week" ? "本周" : "本月"}复盘：完成 ${retro.counts.completed}，滚动 ${retro.counts.rolled}，逾期 ${retro.counts.overdue}。`,
          retro,
        },
      ]);
      void persistSpecial(retro.period === "week" ? "本周复盘" : "本月复盘", { kind: "retro", data: retro });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "读取复盘失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function submitRetroProposal(suggestion: AgentRetroSuggestion) {
    if (!projectId || reviewingProposal) return;
    setReviewingProposal(`retro-${suggestion.title}`);
    try {
      const proposal = await store.request<AgentProposal>("agent/proposals/", "POST", {
        project_id: projectId,
        title: suggestion.title,
        description: suggestion.description,
        category: "process",
      });
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: "已把复盘建议提交三结合评审，等待负责人、成员、技术/财务确认。",
          proposal,
        },
      ]);
      void persistSpecial("已把复盘建议提交三结合评审", { kind: "proposal", data: proposal });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "提交评审失败" },
      ]);
    } finally {
      setReviewingProposal("");
    }
  }

  async function publishRetroSuggestion(suggestion: AgentRetroSuggestion) {
    if (publishingSuggestion) return;
    setPublishingSuggestion(suggestion.title);
    try {
      const issue = await store.request<{ id: string; key: string; title: string; url: string }>(
        "agent/project-issue/",
        "POST",
        {
          project_id: projectId,
          thread_id: threadId || undefined,
          title: suggestion.title,
          description: suggestion.description,
          acceptance: suggestion.acceptance,
          priority: suggestion.priority,
        }
      );
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `已从复盘建议创建工作项：${issue.title}（${issue.key}）`,
          link: { href: issue.url, label: "打开工作项" },
        },
      ]);
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "创建建议任务失败" },
      ]);
    } finally {
      setPublishingSuggestion("");
    }
  }

  async function loadBrief(period: "daily" | "weekly") {
    if (!projectId) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: "请先选择项目，再查看执行简报。" },
      ]);
      return;
    }
    setBusy(true);
    try {
      const brief = await store.request<AgentBrief>(
        `agent/brief/?project_id=${encodeURIComponent(projectId)}&period=${period}`
      );
      setMessages((current) => [...current, { id: newId(), role: "assistant", text: brief.summary, brief }]);
      void persistSpecial(brief.summary, { kind: "brief", data: brief });
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "读取简报失败" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function importProjectPlan(draft: Extract<ChatDraft, { kind: "project_plan" }>) {
    if (importingPlan) return;
    setImportingPlan(true);
    try {
      const result = await store.request<{ count: number; stages: { id: string; key: string }[] }>(
        "agent/project-plan/",
        "POST",
        {
          project_id: projectId,
          thread_id: threadId || undefined,
          plan: {
            summary: draft.summary,
            stages: draft.stages,
            risks: draft.risks,
            assumptions: draft.assumptions,
          },
        }
      );
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `已导入项目计划：${result.stages.length} 个阶段、${result.count} 个任务。`,
          link: { href: `/${workspaceSlug}/lab/planning`, label: "打开项目规划" },
        },
      ]);
      if (threadId) void refreshThreads();
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "导入计划失败" },
      ]);
    } finally {
      setImportingPlan(false);
    }
  }

  async function publishProjectIssue(draft: Extract<ChatDraft, { kind: "project_issue" }>) {
    if (publishing) return;
    setPublishing(true);
    try {
      const issue = await store.request<{ id: string; key: string; title: string; url: string }>(
        "agent/project-issue/",
        "POST",
        {
          project_id: projectId,
          thread_id: threadId || undefined,
          title: draft.title,
          description: draft.description,
          acceptance: draft.acceptance,
          assignee_id: draft.assignee_id || undefined,
          due_date: draft.due_date || undefined,
          priority: draft.priority,
        }
      );
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: `已发布项目工作项：${issue.title}（${issue.key}）`,
          link: { href: issue.url, label: "打开工作项" },
        },
      ]);
      if (threadId) void refreshThreads();
    } catch (problem) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: problem instanceof Error ? problem.message : "发布失败" },
      ]);
    } finally {
      setPublishing(false);
    }
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
        <section className="lab-agent-drawer" data-expanded={expanded} aria-label="AI 助手">
          <header className="lab-agent-head">
            <span className="lab-agent-mark" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div className="lab-agent-title">
              <strong>AI 助手</strong>
              <small>工时 / 工作项 / 可用资金</small>
            </div>
            {!fullPage && (
              <button
                type="button"
                className="lab-agent-reminder-toggle"
                aria-pressed={expanded}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "还原" : "放大"}
              </button>
            )}
            <button
              type="button"
              className="lab-agent-reminder-toggle"
              aria-pressed={showReminders}
              onClick={() => setShowReminders((current) => !current)}
            >
              提醒
            </button>
            <button
              type="button"
              className="lab-agent-close"
              onClick={() => {
                if (fullPage) navigate(`/${workspaceSlug}/lab/planner`);
                else setOpen(false);
              }}
              aria-label="关闭 AI 助手"
            >
              <X size={17} />
            </button>
          </header>
          {projects.length > 0 && (
            <label className="lab-agent-project">
              <span>项目</span>
              <select
                className={labInputClass}
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setThreadId("");
                  setMessages([welcome]);
                }}
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
          <div className="lab-agent-threads">
            <label>
              <span>会话</span>
              <select
                className={labInputClass}
                value={threadId}
                onChange={(event) => void loadThread(event.target.value)}
                aria-label="历史会话"
              >
                <option value="">新对话</option>
                {threads.map((thread) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.title || "未命名会话"}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void loadThread("")}>
              新对话
            </button>
          </div>
          {showReminders && (
            <div className="lab-agent-reminder-settings" aria-label="提醒设置">
              {[
                { kind: "daily_brief" as const, label: "每日简报 08:30" },
                { kind: "weekly_brief" as const, label: "每周一简报 08:30" },
                { kind: "payroll" as const, label: "每月 25 日工资提醒" },
              ].map((item) => {
                const current = reminders.find((row) => row.kind === item.kind);
                return (
                  <label key={item.kind}>
                    <input
                      type="checkbox"
                      checked={current?.enabled ?? false}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setReminders((rows) => {
                          const next = rows.filter((row) => row.kind !== item.kind);
                          return [
                            ...next,
                            {
                              id: current?.id ?? item.kind,
                              kind: item.kind,
                              enabled,
                              hour: current?.hour ?? (item.kind === "daily_brief" ? 8 : 9),
                              weekday: current?.weekday ?? (item.kind === "weekly_brief" ? 1 : null),
                              day_of_month: current?.day_of_month ?? (item.kind === "payroll" ? 25 : null),
                              project_id: projectId,
                            },
                          ];
                        });
                      }}
                    />
                    {item.label}
                  </label>
                );
              })}
              <button type="button" onClick={() => void saveReminders()} disabled={savingReminders}>
                {savingReminders ? "保存中…" : "保存提醒"}
              </button>
            </div>
          )}
          <div className="lab-agent-chips" aria-label="快捷指令">
            {["#工时", "#记录工作项", "#可用资金"].map((tag) => (
              <button key={tag} type="button" onClick={() => chip(tag)}>
                {tag}
              </button>
            ))}
          </div>
          <div className="lab-agent-chips" aria-label="执行简报">
            <button type="button" onClick={() => void loadBrief("daily")}>
              今日简报
            </button>
            <button type="button" onClick={() => void loadBrief("weekly")}>
              本周简报
            </button>
            <button type="button" onClick={() => void loadRetro("week")}>
              本周复盘
            </button>
            <button type="button" onClick={() => void loadRetro("month")}>
              本月复盘
            </button>
            <button type="button" onClick={() => void loadQuality()}>
              质量检查
            </button>
            <button type="button" onClick={() => void loadTeam()}>
              团队负载
            </button>
            <button type="button" onClick={() => setInput("查知识库：")}>
              查知识库
            </button>
            <button type="button" onClick={() => void loadFinance()}>
              财务概览
            </button>
            <button type="button" onClick={() => setInput("会议纪要：")}>
              会议纪要
            </button>
            <button type="button" onClick={() => setInput("提案：")}>
              提交提案
            </button>
            <button type="button" onClick={() => void loadProposals()}>
              评审列表
            </button>
          </div>
          <div className="lab-agent-messages" aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className="lab-agent-message" data-role={message.role}>
                <p>{message.text}</p>
                {message.link && (
                  <a className="lab-agent-link" href={message.link.href}>
                    {message.link.label} →
                  </a>
                )}
                {message.brief && (
                  <div className="lab-agent-brief">
                    <div className="lab-agent-brief-counts">
                      <span>
                        完成 <strong>{message.brief.counts.completed}</strong>
                      </span>
                      <span>
                        进行中 <strong>{message.brief.counts.in_progress}</strong>
                      </span>
                      <span>
                        逾期 <strong>{message.brief.counts.overdue}</strong>
                      </span>
                      <span>
                        无人负责 <strong>{message.brief.counts.unassigned}</strong>
                      </span>
                    </div>
                    {message.brief.risks.length > 0 && (
                      <ul>
                        {message.brief.risks.map((risk) => (
                          <li key={risk}>{risk}</li>
                        ))}
                      </ul>
                    )}
                    {message.brief.overdue.length > 0 && (
                      <div className="lab-agent-brief-list">
                        <strong>逾期</strong>
                        {message.brief.overdue.slice(0, 5).map((issue) => (
                          <span key={issue.id}>
                            {issue.key} {issue.title} · {issue.assignees.join("、") || "无人负责"}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.brief.unassigned.length > 0 && (
                      <div className="lab-agent-brief-list">
                        <strong>无人负责</strong>
                        {message.brief.unassigned.slice(0, 5).map((issue) => (
                          <span key={issue.id}>
                            {issue.key} {issue.title}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.brief.team.length > 0 && (
                      <div className="lab-agent-brief-team">
                        {message.brief.team.slice(0, 6).map((member) => (
                          <span key={member.name}>
                            {member.name} {member.active}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.brief.finance.available && (
                      <small>当前项目可用资金 ¥{message.brief.finance.available}</small>
                    )}
                  </div>
                )}
                {message.draft?.kind === "project_create" && (
                  <div className="lab-agent-lead">
                    <strong>新建项目草稿</strong>
                    <dl>
                      <div>
                        <dt>项目名称</dt>
                        <dd>{message.draft.name}</dd>
                      </div>
                      <div>
                        <dt>起止日期</dt>
                        <dd>
                          {message.draft.start_date} → {message.draft.target_date}
                        </dd>
                      </div>
                      <div>
                        <dt>参与成员</dt>
                        <dd>
                          {message.draft.all_members
                            ? `全部人员（${message.draft.member_names.length} 人）`
                            : message.draft.member_names.slice(0, 8).join("、") || "未指定"}
                        </dd>
                      </div>
                      {message.draft.budget && (
                        <div>
                          <dt>预算</dt>
                          <dd>¥{message.draft.budget}</dd>
                        </div>
                      )}
                      {message.draft.description && (
                        <div>
                          <dt>说明</dt>
                          <dd>{message.draft.description}</dd>
                        </div>
                      )}
                    </dl>
                    {(() => {
                      const name = message.draft?.kind === "project_create" ? message.draft.name : "";
                      const existing = projects.find(
                        (project) => project.name.trim().toLowerCase() === name.trim().toLowerCase()
                      );
                      if (existing) {
                        return (
                          <div className="lab-agent-created-actions">
                            <Button type="button" size="sm" variant="neutral-primary" disabled>
                              已创建
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                navigate(`/${workspaceSlug}/projects/${existing.id}/issues`);
                                setOpen(false);
                              }}
                            >
                              打开项目
                            </Button>
                          </div>
                        );
                      }
                      return (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            const params = new URLSearchParams({
                              name,
                              description: message.draft?.kind === "project_create" ? message.draft.description : "",
                            });
                            navigate(`/${workspaceSlug}/projects/create?${params.toString()}`);
                            setOpen(false);
                          }}
                        >
                          去创建项目
                        </Button>
                      );
                    })()}
                  </div>
                )}
                {message.draft?.kind === "project_lead" && (
                  <div className="lab-agent-lead">
                    <strong>项目负责人变更草稿</strong>
                    <dl>
                      <div>
                        <dt>当前负责人</dt>
                        <dd>{message.draft.current_lead_name}</dd>
                      </div>
                      <div>
                        <dt>新负责人</dt>
                        <dd>{message.draft.target_name}</dd>
                      </div>
                      {message.draft.reason && (
                        <div>
                          <dt>说明</dt>
                          <dd>{message.draft.reason}</dd>
                        </div>
                      )}
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      loading={reviewingLead === "submit"}
                      onClick={() =>
                        void submitLeadRequest(message.draft as Extract<ChatDraft, { kind: "project_lead" }>)
                      }
                    >
                      提交管理员审核
                    </Button>
                  </div>
                )}
                {message.leadRequest && (
                  <div className="lab-agent-lead">
                    <strong>
                      负责人变更 ·{" "}
                      {message.leadRequest.status === "approved"
                        ? "已通过"
                        : message.leadRequest.status === "rejected"
                          ? "已驳回"
                          : "待审核"}
                    </strong>
                    <p>
                      {message.leadRequest.requested_by} 申请把项目负责人改为 {message.leadRequest.target_name}
                    </p>
                    {message.leadRequest.reason && <small>{message.leadRequest.reason}</small>}
                    {message.leadRequest.can_review && message.leadRequest.status === "pending" && (
                      <div className="lab-agent-lead-review">
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          loading={reviewingLead.endsWith("-yes")}
                          onClick={() => void reviewLeadRequest(message.leadRequest!, true)}
                        >
                          通过
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="neutral-primary"
                          loading={reviewingLead.endsWith("-no")}
                          onClick={() => void reviewLeadRequest(message.leadRequest!, false)}
                        >
                          驳回
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {message.proposal && (
                  <ProposalCard proposal={message.proposal} busy={reviewingProposal} onApprove={approveProposal} />
                )}
                {message.proposals && (
                  <div className="lab-agent-proposals">
                    {message.proposals.length === 0 && <small>还没有提案。</small>}
                    {message.proposals.map((proposal) => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        busy={reviewingProposal}
                        onApprove={approveProposal}
                      />
                    ))}
                  </div>
                )}
                {message.meeting && (
                  <div className="lab-agent-meeting">
                    {message.meeting.summary && <p>{message.meeting.summary}</p>}
                    {message.meeting.decisions.length > 0 && (
                      <div className="lab-agent-brief-list">
                        <strong>决策</strong>
                        {message.meeting.decisions.slice(0, 8).map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    )}
                    {message.meeting.risks.length > 0 && (
                      <div className="lab-agent-brief-list">
                        <strong>风险</strong>
                        {message.meeting.risks.slice(0, 8).map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    )}
                    {message.meeting.tasks.length > 0 && (
                      <div className="lab-agent-meeting-tasks">
                        <strong>任务草稿</strong>
                        {message.meeting.tasks.map((task) => (
                          <div key={task.title}>
                            <span>
                              {task.title} · {task.assignee_name || "未分配"} · {task.due_date || "无截止"}
                            </span>
                            <button
                              type="button"
                              disabled={!!publishingMeetingTask}
                              onClick={() => void publishMeetingTask(task)}
                            >
                              {publishingMeetingTask === task.title ? "创建中…" : "发布"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {message.finance && (
                  <div className="lab-agent-finance">
                    {message.finance.can_view_finance && message.finance.summary && (
                      <div className="lab-agent-brief-counts">
                        <span>
                          预算 <strong>¥{message.finance.summary.budget}</strong>
                        </span>
                        <span>
                          已发生 <strong>¥{message.finance.summary.cost}</strong>
                        </span>
                        <span>
                          剩余 <strong>¥{message.finance.summary.remaining}</strong>
                        </span>
                      </div>
                    )}
                    {message.finance.categories.length > 0 && (
                      <div className="lab-agent-finance-categories">
                        {message.finance.categories.map((category) => (
                          <span key={category.category} data-negative={Number(category.remaining) < 0}>
                            {category.label}：¥{category.cost} / ¥{category.budget}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.finance.anomalies.length > 0 && (
                      <div className="lab-agent-brief-list">
                        <strong>异常</strong>
                        {message.finance.anomalies.slice(0, 5).map((item) => (
                          <span key={`${item.kind}-${item.title}`}>
                            {item.title}：{item.detail}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.finance.cashflow && (
                      <small>
                        现金流：收到 ¥{message.finance.cashflow.received}，付出 ¥{message.finance.cashflow.paid}，净额 ¥
                        {message.finance.cashflow.net}
                      </small>
                    )}
                  </div>
                )}
                {message.knowledge && (
                  <div className="lab-agent-knowledge">
                    {message.knowledge.results.map((result) => (
                      <a key={result.id} className="lab-agent-knowledge-item" href={result.url}>
                        <strong>{result.title}</strong>
                        <span>{result.snippet}</span>
                      </a>
                    ))}
                    {message.knowledge.count === 0 && <small>没有找到相关资料。可以换个关键词。</small>}
                  </div>
                )}
                {message.team && (
                  <div className="lab-agent-team">
                    <div className="lab-agent-brief-counts">
                      <span>
                        平均进行中 <strong>{message.team.average_active}</strong>
                      </span>
                      <span>
                        超载 <strong>{message.team.overloaded.length}</strong>
                      </span>
                      <span>
                        无人负责 <strong>{message.team.unassigned.length}</strong>
                      </span>
                    </div>
                    <div className="lab-agent-brief-team">
                      {message.team.members.slice(0, 8).map((member) => (
                        <span key={member.id}>
                          {member.name} {member.active}/{member.overdue}/{member.completed}
                        </span>
                      ))}
                    </div>
                    {message.team.suggestions.length > 0 && (
                      <div className="lab-agent-retro-suggestions">
                        <strong>建议</strong>
                        {message.team.suggestions.map((item) => (
                          <div key={item.title}>
                            <span>
                              {item.title} · {item.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {message.quality && (
                  <div className="lab-agent-quality">
                    <div className="lab-agent-brief-counts">
                      <span>
                        资料 <strong>{message.quality.counts.records}</strong>
                      </span>
                      <span>
                        缺失 <strong>{message.quality.counts.missing}</strong>
                      </span>
                      <span>
                        失效 <strong>{message.quality.counts.stale}</strong>
                      </span>
                      <span>
                        待审 <strong>{message.quality.counts.pending}</strong>
                      </span>
                    </div>
                    {message.quality.missing.length > 0 && (
                      <div className="lab-agent-brief-list">
                        <strong>缺失</strong>
                        {message.quality.missing.slice(0, 5).map((item) => (
                          <span key={item.key ?? item.label}>{item.label ?? item.key}</span>
                        ))}
                      </div>
                    )}
                    {message.quality.stale.length > 0 && (
                      <div className="lab-agent-brief-list">
                        <strong>失效</strong>
                        {message.quality.stale.slice(0, 5).map((item) => (
                          <span key={item.id ?? item.title}>{item.title}</span>
                        ))}
                      </div>
                    )}
                    {message.quality.suggestions.length > 0 && (
                      <div className="lab-agent-retro-suggestions">
                        <strong>建议</strong>
                        {message.quality.suggestions.map((item) => (
                          <div key={item.title}>
                            <span>{item.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <a className="lab-agent-link" href={`/${workspaceSlug}/lab/quality`}>
                      打开质量管理 →
                    </a>
                  </div>
                )}
                {message.retro && (
                  <div className="lab-agent-retro">
                    <div className="lab-agent-brief-counts">
                      <span>
                        完成 <strong>{message.retro.counts.completed}</strong>
                      </span>
                      <span>
                        滚动 <strong>{message.retro.counts.rolled}</strong>
                      </span>
                      <span>
                        逾期 <strong>{message.retro.counts.overdue}</strong>
                      </span>
                      <span>
                        无人负责 <strong>{message.retro.counts.unassigned}</strong>
                      </span>
                    </div>
                    {message.retro.team.length > 0 && (
                      <div className="lab-agent-brief-team">
                        {message.retro.team.slice(0, 6).map((member) => (
                          <span key={member.name}>
                            {member.name} 进行 {member.active} / 完成 {member.completed}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.retro.suggestions.length > 0 && (
                      <div className="lab-agent-retro-suggestions">
                        <strong>改进建议</strong>
                        {message.retro.suggestions.map((suggestion) => (
                          <div key={suggestion.title}>
                            <span>{suggestion.title}</span>
                            <button
                              type="button"
                              disabled={!!publishingSuggestion}
                              onClick={() => void publishRetroSuggestion(suggestion)}
                            >
                              {publishingSuggestion === suggestion.title ? "创建中…" : "变成工作项"}
                            </button>
                            <button
                              type="button"
                              disabled={!!reviewingProposal}
                              onClick={() => void submitRetroProposal(suggestion)}
                            >
                              提交评审
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {message.retro.finance.available && (
                      <small>当前项目可用资金 ¥{message.retro.finance.available}</small>
                    )}
                  </div>
                )}
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
                {message.draft?.kind === "receipt" && (
                  <div className="lab-agent-draft">
                    <strong>入账草稿</strong>
                    <dl>
                      <div>
                        <dt>到账</dt>
                        <dd>¥{message.draft.gross}</dd>
                      </div>
                      <div>
                        <dt>税金</dt>
                        <dd>¥{message.draft.tax}</dd>
                      </div>
                      <div>
                        <dt>管理费</dt>
                        <dd>¥{message.draft.management_fee}</dd>
                      </div>
                      <div>
                        <dt>来源</dt>
                        <dd>{message.draft.source}</dd>
                      </div>
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => openFinanceDraft("receipt", message.draft!)}
                    >
                      去入账确认
                    </Button>
                  </div>
                )}
                {message.draft?.kind === "payroll" && (
                  <div className="lab-agent-draft">
                    <strong>工资草稿</strong>
                    <dl>
                      <div>
                        <dt>成员</dt>
                        <dd>{message.draft.user_name}</dd>
                      </div>
                      <div>
                        <dt>开始</dt>
                        <dd>{message.draft.start}</dd>
                      </div>
                      <div>
                        <dt>结束</dt>
                        <dd>{message.draft.end}</dd>
                      </div>
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => openFinanceDraft("payroll", message.draft!)}
                    >
                      去工资单确认
                    </Button>
                  </div>
                )}
                {message.draft?.kind === "quality" && (
                  <div className="lab-agent-draft">
                    <strong>质量草稿</strong>
                    <p>{message.draft.title}</p>
                    {message.draft.description && <small>{message.draft.description}</small>}
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        navigate(`/${workspaceSlug}/lab/quality`);
                        setOpen(false);
                      }}
                    >
                      去质量管理
                    </Button>
                  </div>
                )}
                {message.draft?.kind === "participation" && (
                  <div className="lab-agent-draft">
                    <strong>成员参与草稿</strong>
                    <dl>
                      <div>
                        <dt>动作</dt>
                        <dd>{message.draft.action === "invite" ? "邀请成员" : "调整权限"}</dd>
                      </div>
                      <div>
                        <dt>成员</dt>
                        <dd>{message.draft.user_name || "未指定"}</dd>
                      </div>
                      {message.draft.note && (
                        <div>
                          <dt>说明</dt>
                          <dd>{message.draft.note}</dd>
                        </div>
                      )}
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        navigate(`/${workspaceSlug}/lab/participation`);
                        setOpen(false);
                      }}
                    >
                      去参与管理
                    </Button>
                  </div>
                )}
                {message.draft?.kind === "project_plan" && (
                  <div className="lab-agent-draft">
                    <strong>项目拆解草稿</strong>
                    {message.draft.summary && <p>{message.draft.summary}</p>}
                    <div className="lab-agent-plan">
                      {message.draft.stages.map((stage, stageIndex) => (
                        <div key={stage.title} className="lab-agent-plan-stage">
                          <strong>
                            {stageIndex + 1}. {stage.title}
                          </strong>
                          <small>
                            {stage.start_date || "未定"} → {stage.target_date || "未定"} · {stage.tasks.length} 个任务
                          </small>
                          {stage.tasks.map((task) => (
                            <div key={task.title} className="lab-agent-plan-task">
                              <span>{task.title}</span>
                              <small>
                                {task.assignee_name || "未分配"} · {task.due_date || "无截止"} · {task.priority}
                              </small>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    {message.draft.risks.length > 0 && <small>风险：{message.draft.risks.join("；")}</small>}
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      loading={importingPlan}
                      onClick={() =>
                        void importProjectPlan(message.draft as Extract<ChatDraft, { kind: "project_plan" }>)
                      }
                    >
                      确认导入项目
                    </Button>
                  </div>
                )}
                {message.draft?.kind === "project_issue" && (
                  <div className="lab-agent-draft">
                    <strong>项目工作项草稿</strong>
                    <dl>
                      <div>
                        <dt>标题</dt>
                        <dd>{message.draft.title}</dd>
                      </div>
                      <div>
                        <dt>负责人</dt>
                        <dd>{message.draft.assignee_name || "未指定"}</dd>
                      </div>
                      <div>
                        <dt>截止</dt>
                        <dd>{message.draft.due_date || "未指定"}</dd>
                      </div>
                      <div>
                        <dt>优先级</dt>
                        <dd>{message.draft.priority}</dd>
                      </div>
                      {message.draft.acceptance && (
                        <div>
                          <dt>验收</dt>
                          <dd>{message.draft.acceptance}</dd>
                        </div>
                      )}
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      loading={publishing}
                      onClick={() =>
                        void publishProjectIssue(message.draft as Extract<ChatDraft, { kind: "project_issue" }>)
                      }
                    >
                      确认发布到项目
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
