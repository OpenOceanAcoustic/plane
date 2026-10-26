/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import { Banknote, CheckCircle2, Plus, Timer } from "lucide-react";
import type { LabCashBounty, LabFinanceOverview } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabAmountInput, LabDialog, LabField, labAmountError, labInputClass } from "@plane/ui";
import { cashTestOptions, cashTestTemplate, type CashTestKind } from "./cash-bounty-test-templates";
// oxlint-disable-next-line import/no-unassigned-import -- cash bounty styles
import "./cash-bounty.css";

const statusLabels: Record<string, string> = {
  proposed: "待审批",
  open: "待接单",
  claimed: "进行中",
  submitted: "待验收",
  accepted: "待付款",
  paid: "已登记付款",
  cancelled: "已取消",
};

const statusTone: Record<string, string> = {
  proposed: "submitted",
  open: "approved",
  claimed: "submitted",
  submitted: "submitted",
  accepted: "submitted",
  paid: "approved",
  cancelled: "rejected",
};

const money = (value: string) =>
  `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function LabCashBounties({ store, refreshKey = 0 }: { store: LabStore; refreshKey?: number }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("bounty_id") ?? "";
  const projects = useMemo(() => store.planner?.projects ?? [], [store.planner?.projects]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [view, setView] = useState<"open" | "mine" | "review" | "all">("open");
  const [publishing, setPublishing] = useState(false);
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [testKind, setTestKind] = useState<CashTestKind>("state");
  const [submitting, setSubmitting] = useState<LabCashBounty>();
  const [feedbackMode, setFeedbackMode] = useState("text");
  const [testResult, setTestResult] = useState("");
  const [accepting, setAccepting] = useState<LabCashBounty>();
  const [paying, setPaying] = useState<LabCashBounty>();
  const [publication, setPublication] = useState({ title: "", target: "", steps: "", deliverable: "", criteria: "" });
  function updatePublication(field: keyof typeof publication, value: string) {
    setPublication((current) => ({ ...current, [field]: value }));
  }
  function closePublication() {
    setPublishing(false);
    setAmount("");
    setTestKind("state");
    setPublication({ title: "", target: "", steps: "", deliverable: "", criteria: "" });
  }
  function useTestingTemplate() {
    setPublication(cashTestTemplate(testKind, store.slug));
  }
  const [rejecting, setRejecting] = useState<LabCashBounty>();
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const {
    data,
    error: loadError,
    mutate,
    isLoading,
  } = useSWR(["lab-cash-bounties", store.slug, refreshKey], () => store.request<LabCashBounty[]>("cash-bounties/"), {
    keepPreviousData: true,
  });
  const { data: finance, error: financeError } = useSWR(
    ["lab-cash-finance", store.slug, projectId, refreshKey],
    () => (projectId ? store.request<LabFinanceOverview>(`finance/overview/?project_id=${projectId}`) : null),
    { keepPreviousData: true, shouldRetryOnError: false }
  );
  const cashAvailable = (finance?.accounts ?? [])
    .filter((account) => account.project_id === projectId && account.kind === "project")
    .reduce((total, account) => total + Number(account.available || 0), 0);
  const me = store.planner?.user_id;
  const rows = (data ?? []).filter((row) => {
    if (selectedId) return row.id === selectedId;
    if (view === "all") return true;
    if (view === "review") return row.can_approve || row.can_reject;
    if (view === "open") return row.status === "open";
    return row.claimed_by?.id === me || row.publisher?.id === me;
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  function clearSelection() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("bounty_id");
      return next;
    });
  }
  const currentProject = projects.find((project) => project.id === projectId) ?? projects[0];

  async function act(row: LabCashBounty, action: string, body: Record<string, string> = {}) {
    setBusyId(row.id);
    setError("");
    setNotice("");
    try {
      await store.request(`cash-bounties/${row.id}/${action}/`, "POST", body);
      await mutate();
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "操作失败");
      return false;
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="lab-cash-bounties">
      <div className="lab-cash-toolbar">
        <div className="lab-cash-tabs" role="group" aria-label="现金悬赏筛选">
          {[
            { id: "open", label: "可接单" },
            { id: "mine", label: "我的" },
            { id: "review", label: "待审批" },
            { id: "all", label: "全部" },
          ].map((tab) => (
            <Button
              key={tab.id}
              size="sm"
              variant={view === tab.id ? "primary" : "neutral-primary"}
              aria-pressed={view === tab.id}
              onClick={() => {
                clearSelection();
                setView(tab.id as typeof view);
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => setPublishing(true)} disabled={!projects.length}>
          <Plus size={14} className="mr-1" />
          {currentProject?.lead ? "发布现金悬赏" : "提议现金悬赏"}
        </Button>
      </div>
      {!projects.length && <p className="text-13 text-secondary">你还没有可参与的项目。</p>}
      {selectedId && (
        <Button
          size="sm"
          variant="neutral-primary"
          onClick={() => {
            clearSelection();
            setView("all");
          }}
        >
          查看全部现金悬赏
        </Button>
      )}
      {(error || loadError) && (
        <p role="alert" className="lab-cash-alert">
          {error || (loadError instanceof Error ? loadError.message : "现金悬赏读取失败")}
        </p>
      )}
      {notice && <p className="lab-cash-notice">{notice}</p>}
      {isLoading ? (
        <p role="status">正在加载现金悬赏…</p>
      ) : selectedId && !rows.length && !loadError ? (
        <p role="alert">悬赏不存在或你暂无查看权限。</p>
      ) : !rows.length ? (
        <div className="lab-cash-empty">
          <Banknote size={22} aria-hidden="true" />
          <p>
            {view === "open"
              ? "现在没有可接的现金悬赏。"
              : view === "review"
                ? "没有待审批的现金悬赏。"
                : "还没有现金悬赏记录。"}
          </p>
          {projects.length > 0 && (
            <Button size="sm" variant="neutral-primary" onClick={() => setPublishing(true)}>
              {currentProject?.lead ? "发布第一条" : "提议第一条"}
            </Button>
          )}
        </div>
      ) : (
        <div className="lab-cash-grid" aria-label="现金悬赏列表">
          {rows.map((row) => (
            <article className="lab-cash-card" key={row.id} data-status={row.status} aria-label={row.title}>
              <header className="lab-cash-card-head">
                <div>
                  <p className="lab-cash-project">{row.project}</p>
                  <h2>{row.title}</h2>
                </div>
                <span className="lab-status-pill" data-state={statusTone[row.status] ?? "submitted"}>
                  {statusLabels[row.status] ?? row.status}
                </span>
              </header>
              <p className="lab-cash-amount">{money(row.amount)}</p>
              <dl className="lab-cash-meta">
                <div>
                  <dt>{row.status === "proposed" ? "提议人" : "发布人"}</dt>
                  <dd>{row.publisher?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt>验收人</dt>
                  <dd>{row.reviewer?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt>{row.claimed_by ? "接单人" : "状态"}</dt>
                  <dd>{row.claimed_by?.name ?? (row.status === "proposed" ? "等待负责人审批" : "等待接单")}</dd>
                </div>
                {row.due_at && (
                  <div>
                    <dt>截止</dt>
                    <dd>{new Date(row.due_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd>
                  </div>
                )}
              </dl>
              <section aria-label="任务说明与交付要求">
                <h3 className="text-12 font-medium">任务说明与交付要求</h3>
                <p className="lab-cash-deliverable">{row.deliverable}</p>
              </section>
              {row.criteria && <p className="lab-cash-deliverable">验收标准：{row.criteria}</p>}
              {row.acceptance_note && <p className="lab-cash-evidence">验收意见：{row.acceptance_note}</p>}
              {row.paid_at && (
                <p className="lab-cash-evidence">
                  付款登记时间：{new Date(row.paid_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                </p>
              )}
              {row.review_note && (
                <p className="lab-cash-evidence">
                  <CheckCircle2 size={13} /> 审批意见：{row.review_note}
                </p>
              )}
              {row.evidence && (
                <p className="lab-cash-evidence">
                  <CheckCircle2 size={13} /> <span>成果：{row.evidence}</span>
                </p>
              )}
              <div className="lab-cash-actions">
                {row.can_approve && (
                  <Button size="sm" loading={busyId === row.id} onClick={() => void act(row, "approve")}>
                    批准
                  </Button>
                )}
                {row.can_reject && (
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    loading={busyId === row.id}
                    onClick={() => setRejecting(row)}
                  >
                    驳回
                  </Button>
                )}
                {row.can_claim && (
                  <Button size="sm" loading={busyId === row.id} onClick={() => void act(row, "claim")}>
                    <Timer size={13} className="mr-1" />
                    我要接
                  </Button>
                )}
                {row.can_submit && (
                  <Button
                    size="sm"
                    loading={busyId === row.id}
                    onClick={() => {
                      setFeedbackMode("text");
                      setTestResult("");
                      setError("");
                      setSubmitting(row);
                    }}
                  >
                    提交成果
                  </Button>
                )}
                {row.can_accept && (
                  <Button size="sm" loading={busyId === row.id} onClick={() => setAccepting(row)}>
                    <CheckCircle2 size={13} className="mr-1" />
                    验收成果
                  </Button>
                )}
                {row.can_pay && (
                  <Button size="sm" loading={busyId === row.id} onClick={() => setPaying(row)}>
                    <Banknote size={13} className="mr-1" />
                    登记付款 {money(row.amount)}
                  </Button>
                )}
                {row.can_cancel && (
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    loading={busyId === row.id}
                    onClick={() => {
                      if (window.confirm("取消这条现金悬赏？")) void act(row, "cancel");
                    }}
                  >
                    {row.status === "proposed" ? "撤回" : "取消"}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {publishing && (
        <LabDialog
          title={currentProject?.lead ? "发布现金悬赏" : "提议现金悬赏"}
          submitLabel={currentProject?.lead ? "发布" : "提交审批"}
          busy={publishingBusy}
          error={error}
          submitDisabled={
            !projectId ||
            !amount ||
            Object.values(publication).some((value) => !value.trim()) ||
            !!labAmountError(amount, { min: "0.01", unit: "元" })
          }
          onClose={closePublication}
          onSubmit={async (form) => {
            if (publishingBusy) return;
            setPublishingBusy(true);
            setError("");
            try {
              await store.request("cash-bounties/", "POST", {
                project_id: projectId,
                ...publication,
                amount: form.get("amount"),
                due_at: form.get("due_at") || null,
              });
              await mutate();
              closePublication();
              clearSelection();
              setView(currentProject?.lead ? "open" : "mine");
              setNotice(currentProject?.lead ? "现金悬赏已发布。" : "现金悬赏提议已提交，等待负责人审批。");
            } catch (problem) {
              setError(problem instanceof Error ? problem.message : "发布失败");
            } finally {
              setPublishingBusy(false);
            }
          }}
        >
          <LabField label="项目">
            <select
              className={labInputClass}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.lead ? " · 负责人" : " · 成员提议"}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="测试类型">
            <select
              className={labInputClass}
              value={testKind}
              onChange={(event) => setTestKind(event.target.value as CashTestKind)}
            >
              {cashTestOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </LabField>
          <Button type="button" size="sm" variant="neutral-primary" onClick={useTestingTemplate}>
            填入人工测试模板
          </Button>
          <LabField label="任务名称">
            <input
              name="title"
              className={labInputClass}
              required
              maxLength={255}
              value={publication.title}
              onChange={(event) => updatePublication("title", event.target.value)}
              placeholder="例如：现金悬赏页面人工测试"
            />
          </LabField>
          <LabField label="任务入口与范围">
            <textarea
              name="target"
              className={labInputClass}
              required
              rows={3}
              value={publication.target}
              onChange={(event) => updatePublication("target", event.target.value)}
              placeholder="完整页面地址或具体任务对象；测试账号角色、设备与本次范围"
            />
          </LabField>
          <LabField label="操作步骤">
            <textarea
              name="steps"
              className={labInputClass}
              required
              rows={5}
              value={publication.steps}
              onChange={(event) => updatePublication("steps", event.target.value)}
              placeholder="1. 从哪个入口进入\n2. 点击什么、输入什么\n3. 检查哪些结果"
            />
          </LabField>
          <LabField label="固定赏金（元）">
            <LabAmountInput
              name="amount"
              aria-label="现金赏金"
              value={amount}
              onValueChange={setAmount}
              unit="元"
              min="0.01"
              step="0.01"
              required
            />
          </LabField>
          <LabField label="交付要求">
            <textarea
              name="deliverable"
              className={labInputClass}
              required
              rows={3}
              value={publication.deliverable}
              onChange={(event) => updatePublication("deliverable", event.target.value)}
              placeholder="文字反馈：已测步骤、测试结论、预期与实际结果；无问题时写明覆盖了哪些操作"
            />
          </LabField>
          <LabField label="验收标准">
            <textarea
              name="criteria"
              className={labInputClass}
              required
              rows={3}
              value={publication.criteria}
              onChange={(event) => updatePublication("criteria", event.target.value)}
              placeholder="需要覆盖哪些场景；怎样证明完成，怎样算通过"
            />
          </LabField>
          <LabField label="截止时间（可选）">
            <input type="datetime-local" name="due_at" className={labInputClass} />
          </LabField>
          {currentProject && (
            <div className="space-y-1">
              <p className="text-12 text-secondary">
                项目当前可用现金：
                <strong> {financeError ? "暂不可读" : `¥${cashAvailable.toFixed(2)}`}</strong>
              </p>
              {!financeError && cashAvailable <= 0 && (
                <p role="status" className="text-12 text-danger-primary">
                  当前项目可用现金为 0。可以先发布和接单，但验收付款前需要先到「资金与奖励 → 入账」登记到账。
                </p>
              )}
              <p className="text-12 text-secondary">
                付款时从「{currentProject.name}」的项目已到账资金支出；余额不足会提示。
              </p>
            </div>
          )}
        </LabDialog>
      )}

      {submitting && (
        <LabDialog
          title="提交成果"
          submitLabel="提交验收"
          busy={busyId === submitting.id}
          error={error}
          onClose={() => setSubmitting(undefined)}
          onSubmit={async (form) => {
            const body: Record<string, string> =
              feedbackMode === "test"
                ? {
                    feedback_mode: "test",
                    test_result: testResult,
                    test_steps: String(form.get("test_steps") ?? ""),
                    feedback: String(form.get("feedback") ?? ""),
                  }
                : { feedback_mode: "text", evidence: String(form.get("evidence") ?? "") };
            if (await act(submitting, "submit", body)) setSubmitting(undefined);
          }}
        >
          <LabField label="反馈方式">
            <select
              className={labInputClass}
              value={feedbackMode}
              onChange={(event) => setFeedbackMode(event.target.value)}
            >
              <option value="text">交付说明</option>
              <option value="test">测试反馈</option>
            </select>
          </LabField>
          {feedbackMode === "test" ? (
            <>
              <LabField label="测试结论">
                <select
                  className={labInputClass}
                  value={testResult}
                  onChange={(event) => setTestResult(event.target.value)}
                  required
                >
                  <option value="">请选择</option>
                  <option value="pass">通过</option>
                  <option value="fail">不通过</option>
                  <option value="blocked">无法测试</option>
                </select>
              </LabField>
              <LabField label="已测步骤与实际结果">
                <textarea
                  name="test_steps"
                  className={labInputClass}
                  rows={5}
                  required
                  placeholder="逐项写明：从哪里进入、点击什么、实际看到什么；未覆盖项注明原因"
                />
              </LabField>
              <LabField label={testResult === "pass" ? "问题或建议（可选）" : "问题或无法测试的原因"}>
                <textarea
                  name="feedback"
                  className={labInputClass}
                  rows={5}
                  required={testResult !== "pass"}
                  placeholder="复现步骤 → 预期结果 → 实际结果；或说明哪一步无法执行及原因"
                />
              </LabField>
            </>
          ) : (
            <LabField label="成果、链接或交付说明">
              <textarea name="evidence" className={labInputClass} rows={5} required />
            </LabField>
          )}
        </LabDialog>
      )}

      {rejecting && (
        <LabDialog
          title="驳回现金悬赏"
          submitLabel="确认驳回"
          busy={busyId === rejecting.id}
          error={error}
          onClose={() => setRejecting(undefined)}
          onSubmit={async (form) => {
            await act(rejecting, "reject", { note: String(form.get("note") ?? "") });
            setRejecting(undefined);
          }}
        >
          <p className="text-13">驳回「{rejecting.title}」，提议人可以看到原因。</p>
          <LabField label="驳回原因">
            <textarea name="note" className={labInputClass} rows={3} required />
          </LabField>
        </LabDialog>
      )}

      {paying && (
        <LabDialog
          title="登记线下付款"
          submitLabel="确认登记付款"
          busy={busyId === paying.id}
          error={error}
          onClose={() => setPaying(undefined)}
          onSubmit={async (form) => {
            if (await act(paying, "pay", { payment_evidence: String(form.get("payment_evidence") ?? "") })) {
              setNotice("已登记付款。");
              setPaying(undefined);
            }
          }}
        >
          <p className="text-13">
            为「{paying.title}」登记 {money(paying.amount)} 项目支出。这不会发起银行卡、微信或支付宝转账。
          </p>
          <LabField label="付款凭证或测试记账说明">
            <textarea
              name="payment_evidence"
              className={labInputClass}
              required
              rows={3}
              placeholder="填写真实转账凭证；流程测试须注明测试记账、未实际转账"
            />
          </LabField>
        </LabDialog>
      )}
      {accepting && (
        <LabDialog
          title="验收成果"
          submitLabel="验收通过"
          busy={busyId === accepting.id}
          error={error}
          onClose={() => setAccepting(undefined)}
          onSubmit={async (form) => {
            if (await act(accepting, "accept", { note: String(form.get("note") ?? "") })) setAccepting(undefined);
          }}
        >
          <p className="text-13">
            确认「{accepting.title}」已按约定完成。验收通过后，{money(accepting.amount)} 进入待付款状态。
          </p>
          <LabField label="验收意见（可选）">
            <textarea name="note" className={labInputClass} rows={3} placeholder="例如：成果已收到，符合要求" />
          </LabField>
        </LabDialog>
      )}
    </div>
  );
}
