/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { observer } from "mobx-react";
import { Link, useSearchParams } from "react-router";
import useSWR from "swr";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Handshake,
  MessageSquare,
  ShieldCheck,
  Timer,
  UserRound,
  Users,
} from "lucide-react";
import { ChatStore } from "@plane/shared-state";
import type { LabStore } from "@plane/shared-state";
import type { LabFinanceManagement, LabFinancePermissionMembers, LabProjectQuality } from "@plane/types";
import { Button, labDecimalText, labDecimalUnits, labInputClass } from "@plane/ui";
import { Metric } from "./finance-workbench";
// oxlint-disable-next-line import/no-unassigned-import -- shared workbench surfaces
import "./workbench.css";
// oxlint-disable-next-line import/no-unassigned-import -- participation surfaces
import "./participation.css";

const permissionLabels: Record<string, string> = {
  view: "查看",
  record: "登记",
  approve: "审核",
  pay: "付款",
};
const currentMonth = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 7);
const dateOf = (value: string | undefined) => value ?? "";
const money = (value: string | null | undefined) => `¥${labDecimalText(labDecimalUnits(value ?? "0") ?? 0n)}`;
const stamp = (value: string | undefined) =>
  value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!
  );
const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
const tagOf = (html: string) => /【(经费协商|流程简化|三方会审)】/.exec(html)?.[1] ?? "";

type ParticipationKind = "经费协商" | "流程简化" | "三方会审";

export const LabParticipation = observer(function LabParticipation({
  store,
  refreshKey,
}: {
  store: LabStore;
  refreshKey: number;
}) {
  const [params, setParams] = useSearchParams();
  const projects = store.planner?.projects ?? [];
  const projectId = params.get("project_id") ?? (projects.length === 1 ? projects[0]!.id : "");
  const selectedProject = projects.find((project) => project.id === projectId);
  const setProject = (id: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("project_id", id);
      else next.set("project_id", "");
      return next;
    });

  const { data: management, error: managementError } = useSWR(
    projectId ? ["lab-finance-management", store.slug, projectId, refreshKey] : null,
    () => store.request<LabFinanceManagement>(`projects/${projectId}/finance-management/`),
    { keepPreviousData: true, shouldRetryOnError: false }
  );
  const { data: quality, error: qualityError } = useSWR(
    projectId ? ["lab-project-quality", store.slug, projectId, refreshKey] : null,
    () => store.request<LabProjectQuality>(`projects/${projectId}/quality/`),
    { keepPreviousData: true, shouldRetryOnError: false }
  );
  const { data: permissions, error: permissionError } = useSWR(
    projectId ? ["lab-finance-permissions", store.slug, projectId] : null,
    () => store.request<LabFinancePermissionMembers>(`finance/permissions/?project_id=${projectId}`),
    { keepPreviousData: true, shouldRetryOnError: false }
  );

  const chat = useMemo(() => new ChatStore(store.apiBase, store.slug, store), [store]);
  const [chatState, setChatState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (!projectId) {
      setChatState("loading");
      return;
    }
    let active = true;
    setChatState("loading");
    void chat
      .resolve("project", projectId)
      .then((thread) => (active ? chat.open(thread.id) : undefined))
      .then(() => {
        if (active) setChatState(chat.thread ? "ready" : "error");
        return undefined;
      })
      .catch(() => {
        if (active) setChatState("error");
      });
    return () => {
      active = false;
    };
  }, [chat, projectId]);

  const [kind, setKind] = useState<ParticipationKind>("经费协商");
  const [topic, setTopic] = useState("预算");
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const myId = management?.user_id ?? store.planner?.user_id ?? "";
  const permissionsAvailable = !!permissions && !permissionError;
  const permissionMembers = permissions?.members ?? [];
  const ownerIds = new Set(permissionMembers.filter((member) => member.owner).map((member) => member.id));
  const ownerNames = permissionMembers.filter((member) => member.owner).map((member) => member.name);
  const managerMembers = permissionMembers.filter(
    (member) =>
      !member.owner && member.permissions.some((permission) => ["record", "approve", "pay"].includes(permission))
  );
  const qualityReviewers = new Set(
    (quality?.records ?? []).map((record) => record.data.reviewed_by).filter((name): name is string => !!name)
  );
  const independentReviews = (quality?.records ?? []).filter(
    (record) => record.data.reviewed_by && record.data.reviewed_by !== record.actor
  );
  const costs = (management?.records ?? []).filter((record) => record.kind === "cost" && record.state !== "cancelled");
  const ownerHours = costs
    .filter((record) => ownerIds.has(record.data.user_id ?? ""))
    .reduce((sum, record) => sum + (Number(record.data.hours) || 0), 0);
  const totalHours = costs.reduce((sum, record) => sum + (Number(record.data.hours) || 0), 0);
  const myCosts = costs.filter((record) => record.data.user_id === myId);
  const myMonthHours = myCosts
    .filter((record) => dateOf(record.data.date ?? record.data.start).startsWith(currentMonth()))
    .reduce((sum, record) => sum + (Number(record.data.hours) || 0), 0);
  const myPendingCosts = myCosts.filter((record) => record.state === "submitted");
  const myPayroll = (management?.records ?? []).filter(
    (record) => record.kind === "payroll" && record.data.user_id === myId && record.state === "ready"
  );
  const myPayrollTotal = myPayroll.reduce(
    (sum, record) => sum + (labDecimalUnits(record.recognized_amount ?? record.data.amount ?? "0") ?? 0n),
    0n
  );
  const myPermissions = permissionMembers.find((member) => member.id === myId)?.permissions ?? [];
  const myRole = permissionsAvailable
    ? ownerIds.has(myId)
      ? "负责人"
      : myPermissions.length
        ? "参与管理"
        : "成员"
    : selectedProject?.lead
      ? "负责人"
      : "成员";

  const tagged = chat.messages
    .filter((message) => tagOf(message.comment_html))
    .slice()
    // oxlint-disable-next-line no-array-reverse -- display-only copy
    .reverse();
  const suggestionMessages = tagged.filter((message) => tagOf(message.comment_html) === "流程简化");
  const reviewMessages = tagged.filter((message) => tagOf(message.comment_html) === "三方会审");
  const latest = tagged.slice(0, 6);
  const chatReady = chatState === "ready" && !!chat.thread;
  const canWrite = chatReady && chat.thread?.can_write !== false;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chat.thread || !text.trim() || posting || !canWrite) return;
    setPosting(true);
    setFormError("");
    try {
      const numericAmount = amount.replace(/[^\d.]/g, "");
      const addition = kind === "经费协商" && numericAmount ? `，金额 ¥${numericAmount}` : "";
      await chat.send(chat.thread.id, {
        comment_html: `<p>【${kind}】${topic}${addition}：${escapeHtml(text.trim())}</p>`,
      });
      setText("");
      setAmount("");
    } catch (problem) {
      setFormError(problem instanceof Error ? problem.message : "发布失败，请稍后重试");
    } finally {
      setPosting(false);
    }
  };

  const openReview = () => {
    setKind("三方会审");
    setText("请会审以下事项：");
    textarea.current?.focus();
  };

  if (!projectId)
    return (
      <section className="lab-workbench-panel" aria-label="选择参与管理项目">
        <header className="lab-workbench-panel-head">
          <h2>选择项目</h2>
        </header>
        {projects.length ? (
          <div className="lab-project-picker">
            {projects.map((project) => (
              <button
                type="button"
                key={project.id}
                className="lab-project-option"
                onClick={() => setProject(project.id)}
              >
                <strong>{project.name}</strong>
                <span>{project.lead ? "负责人" : "项目成员"}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-13 text-secondary">暂无可参与项目。</p>
        )}
      </section>
    );

  return (
    <div className="space-y-4">
      <div className="lab-command">
        <label className="lab-command-project">
          <span className="whitespace-nowrap">项目</span>
          <select
            aria-label="参与管理项目"
            value={projectId}
            className={labInputClass}
            onChange={(event) => setProject(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <div className="lab-command-chips">
          <span className="lab-command-chip">
            <UserRound size={12} />
            我的角色 <strong>{myRole}</strong>
          </span>
          <span className="lab-command-chip">
            <Timer size={12} />
            本月 <strong>{myMonthHours}</strong> 小时
          </span>
          <span className="lab-command-chip">
            <Users size={12} />
            可见 <strong>{totalHours}</strong> 小时
          </span>
        </div>
        {chat.thread && (
          <Link className="lab-quick-action ml-auto" to={`/${store.slug}/lab/chat?thread=${chat.thread.id}`}>
            <MessageSquare size={14} />
            项目聊天
            <ArrowRight size={12} />
          </Link>
        )}
        <Link className="lab-quick-action" to={`/${store.slug}/settings/projects/${projectId}/members/`}>
          <Users size={14} />
          邀请/管理成员
          <ArrowRight size={12} />
        </Link>
      </div>

      {managementError && (
        <p role="alert" className="text-13 text-danger-primary">
          {managementError instanceof Error ? managementError.message : "参与数据读取失败"}
        </p>
      )}
      {qualityError && (
        <p role="alert" className="text-13 text-danger-primary">
          {qualityError instanceof Error ? qualityError.message : "质量数据读取失败"}
        </p>
      )}

      <section className="lab-metric-grid" aria-label="参与管理概览">
        <Metric
          tone="orange"
          icon={<Timer size={15} />}
          label="干部参加劳动"
          value={permissionsAvailable ? `${ownerHours} 小时` : "—"}
          hint={
            permissionsAvailable
              ? ownerNames.length
                ? `${ownerNames.join("、")} 已登记`
                : "负责人尚未登记工时"
              : "负责人工时仅负责人可见"
          }
        />
        <Metric
          tone="emerald"
          icon={<Users size={15} />}
          label="工人参加管理"
          value={permissionsAvailable ? `${managerMembers.length} 人` : `${qualityReviewers.size} 人`}
          hint={permissionsAvailable ? `财务分工 · 质量评审 ${qualityReviewers.size} 人` : "质量评审记录"}
        />
        <Metric
          tone="indigo"
          icon={<ShieldCheck size={15} />}
          label="独立评审"
          value={`${independentReviews.length} 份`}
          hint="提交人与评审人不同"
        />
        <Metric
          tone="purple"
          icon={<Handshake size={15} />}
          label="流程简化建议"
          value={`${suggestionMessages.length} 条`}
          hint="来自参与讨论"
        />
      </section>

      <div className="lab-workbench-grid">
        <section className="lab-workbench-panel space-y-3" aria-label="经费协商与流程建议">
          <header className="lab-workbench-panel-head">
            <h2>经费协商与流程建议</h2>
            <span className="lab-status-pill" data-state={canWrite ? "approved" : "submitted"}>
              {canWrite ? "可以发言" : chatState === "loading" ? "正在连接聊天" : "只读"}
            </span>
          </header>
          <form className="lab-participation-form" onSubmit={submit}>
            <div className="lab-participation-fields">
              <select
                aria-label="参与类型"
                className={labInputClass}
                value={kind}
                onChange={(event) => setKind(event.target.value as ParticipationKind)}
              >
                <option value="经费协商">经费协商</option>
                <option value="流程简化">流程简化建议</option>
                <option value="三方会审">三方会审</option>
              </select>
              {kind === "经费协商" && (
                <>
                  <select
                    aria-label="协商主题"
                    className={labInputClass}
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                  >
                    <option value="预算">预算</option>
                    <option value="工资">工资</option>
                    <option value="报销">报销</option>
                    <option value="工时">工时</option>
                    <option value="其他">其他</option>
                  </select>
                  <input
                    aria-label="涉及金额（可选）"
                    className={labInputClass}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="金额（可选）"
                    inputMode="decimal"
                  />
                </>
              )}
            </div>
            <textarea
              ref={textarea}
              aria-label="参与内容"
              className={labInputClass}
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                kind === "经费协商"
                  ? "说明希望调整的预算、工资或工时，以及你的依据。负责人会在项目聊天里回应。"
                  : kind === "流程简化"
                    ? "哪一步最麻烦？你希望怎么改？"
                    : "说明需要会审的问题、涉及的角色和期望结论。"
              }
              required
            />
            <div className="lab-participation-submit">
              <p className="text-11 text-secondary">发布到项目聊天，负责人和成员都能看到，不会自动修改账本。</p>
              <Button type="submit" size="sm" loading={posting} disabled={!canWrite || !text.trim()}>
                {kind === "经费协商" ? "发布协商" : kind === "流程简化" ? "提交建议" : "发起会审"}
              </Button>
            </div>
            {formError && (
              <p role="alert" className="text-12 text-danger-primary">
                {formError}
              </p>
            )}
          </form>

          <div className="lab-participation-messages" aria-label="参与记录">
            {latest.length ? (
              latest.map((message) => {
                const tag = tagOf(message.comment_html);
                return (
                  <article className="lab-participation-message" key={message.id}>
                    <header>
                      <span className="lab-participation-tag" data-kind={tag}>
                        {tag}
                      </span>
                      <strong>{message.actor_detail?.display_name ?? "成员"}</strong>
                      <time>{stamp(message.created_at)}</time>
                    </header>
                    <p>{plainText(message.comment_html)}</p>
                    {chat.thread && (
                      <Link className="lab-participation-link" to={`/${store.slug}/lab/chat?thread=${chat.thread.id}`}>
                        在聊天中回复 <ArrowRight size={12} />
                      </Link>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="flex flex-col items-start gap-2 py-2">
                <p className="text-13 text-secondary">
                  {chatState === "loading"
                    ? "正在连接项目聊天…"
                    : chatState === "error"
                      ? "项目聊天暂不可用，稍后再试。"
                      : "还没有协商记录。发起第一条，负责人会在项目聊天里看到。"}
                </p>
                {chatState === "error" && (
                  <Link className="lab-quick-action" to={`/${store.slug}/lab/chat`}>
                    <MessageSquare size={14} />
                    去聊天
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="space-y-4">
          <section className="lab-workbench-panel space-y-3" aria-label="我的参与">
            <header className="lab-workbench-panel-head">
              <h2>我的参与</h2>
              <span className="lab-status-pill" data-state={myRole === "负责人" ? "approved" : "submitted"}>
                {myRole}
              </span>
            </header>
            <dl className="lab-participation-stats">
              <div>
                <dt>本月工时</dt>
                <dd>{myMonthHours} 小时</dd>
              </div>
              <div>
                <dt>待审费用</dt>
                <dd>{myPendingCosts.length} 笔</dd>
              </div>
              <div>
                <dt>待发工资</dt>
                <dd>{money(labDecimalText(myPayrollTotal))}</dd>
              </div>
            </dl>
            <p className="text-12 text-secondary">
              {permissionsAvailable && myPermissions.length
                ? `我的财务分工：${myPermissions.map((permission) => permissionLabels[permission] ?? permission).join("、")}`
                : permissionsAvailable
                  ? "我目前以普通成员身份参与。"
                  : "财务分工仅负责人可见；你仍可发起协商和查看自己的工时、工资。"}
            </p>
          </section>

          <section className="lab-workbench-panel space-y-3" aria-label="参与结构">
            <header className="lab-workbench-panel-head">
              <h2>参与结构</h2>
            </header>
            <dl className="lab-participation-structure">
              {permissionsAvailable ? (
                <>
                  <div>
                    <dt>负责人</dt>
                    <dd>{ownerNames.length ? ownerNames.join("、") : "未指定"}</dd>
                  </div>
                  <div>
                    <dt>财务分工</dt>
                    <dd>
                      {managerMembers.length
                        ? managerMembers
                            .map(
                              (member) =>
                                `${member.name}（${member.permissions
                                  .map((permission) => permissionLabels[permission] ?? permission)
                                  .join("、")}）`
                            )
                            .join("、")
                        : "暂无 delegated 财务分工"}
                    </dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>负责人与财务分工</dt>
                  <dd>仅负责人可见</dd>
                </div>
              )}
              <div>
                <dt>质量评审人</dt>
                <dd>{qualityReviewers.size ? [...qualityReviewers].join("、") : "暂无评审记录"}</dd>
              </div>
            </dl>
          </section>

          <section className="lab-workbench-panel space-y-3" aria-label="独立评审与三方会审">
            <header className="lab-workbench-panel-head">
              <h2>独立评审与三方会审</h2>
              <Button size="sm" variant="neutral-primary" onClick={openReview}>
                发起会审
              </Button>
            </header>
            {independentReviews.length ? (
              <div className="space-y-2">
                {independentReviews.slice(0, 3).map((record) => (
                  <div className="lab-participation-review" key={record.id}>
                    <ClipboardCheck size={14} aria-hidden="true" />
                    <div className="min-w-0">
                      <p>{record.data.title || "资料记录"}</p>
                      <small>
                        {record.actor} 提交 · {record.data.reviewed_by} 评审
                      </small>
                    </div>
                  </div>
                ))}
                {reviewMessages.length > 0 && (
                  <p className="text-11 text-secondary">另有 {reviewMessages.length} 条会审讨论。</p>
                )}
              </div>
            ) : (
              <p className="text-13 text-secondary">暂无独立评审记录。</p>
            )}
          </section>

          <section className="lab-workbench-panel space-y-2" aria-label="已落地的简化">
            <header className="lab-workbench-panel-head">
              <h2>已落地的简化</h2>
            </header>
            {[
              "阶段预算快速模式：自动生成用途，隐藏成员比例",
              "外部到账自动计算税金、管理费和净额",
              "工时、报销、入账进入首屏快捷操作",
              "质量资料按状态筛选，一键评审或补登",
            ].map((item) => (
              <p className="lab-participation-check" key={item}>
                <CheckCircle2 size={14} aria-hidden="true" />
                {item}
              </p>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
});
