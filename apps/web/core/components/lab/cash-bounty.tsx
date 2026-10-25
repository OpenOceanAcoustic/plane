/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import { Banknote, CheckCircle2, Plus, Timer } from "lucide-react";
import type { LabCashBounty, LabFinanceOverview } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabAmountInput, LabDialog, LabField, labAmountError, labInputClass } from "@plane/ui";
// oxlint-disable-next-line import/no-unassigned-import -- cash bounty styles
import "./cash-bounty.css";

const statusLabels: Record<string, string> = {
  proposed: "待审批",
  open: "待接单",
  claimed: "进行中",
  submitted: "待验收",
  accepted: "待付款",
  paid: "已付款",
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
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState<LabCashBounty>();
  const [accepting, setAccepting] = useState<LabCashBounty>();
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
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "操作失败");
    } finally {
      setBusyId("");
    }
  }

  async function acceptAndPay(row: LabCashBounty, note: string) {
    setBusyId(row.id);
    setError("");
    setNotice("");
    try {
      await store.request(`cash-bounties/${row.id}/accept/`, "POST", { note });
      try {
        await store.request(`cash-bounties/${row.id}/pay/`, "POST", {});
        setNotice("已验收并付款。");
      } catch (problem) {
        setNotice(
          `已验收通过，但付款失败：${problem instanceof Error ? problem.message : "未知原因"}。可在卡片上重试付款。`
        );
      }
      await mutate();
      setAccepting(undefined);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "验收失败");
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
              <p className="lab-cash-deliverable">{row.deliverable}</p>
              {row.criteria && <p className="lab-cash-deliverable">验收标准：{row.criteria}</p>}
              {row.review_note && (
                <p className="lab-cash-evidence">
                  <CheckCircle2 size={13} /> 审批意见：{row.review_note}
                </p>
              )}
              {row.evidence && (
                <p className="lab-cash-evidence">
                  <CheckCircle2 size={13} /> 成果：{row.evidence}
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
                  <Button size="sm" loading={busyId === row.id} onClick={() => setSubmitting(row)}>
                    提交成果
                  </Button>
                )}
                {row.can_accept && (
                  <Button size="sm" loading={busyId === row.id} onClick={() => setAccepting(row)}>
                    <CheckCircle2 size={13} className="mr-1" />
                    验收并付款
                  </Button>
                )}
                {row.can_pay && (
                  <Button size="sm" loading={busyId === row.id} onClick={() => void act(row, "pay")}>
                    <Banknote size={13} className="mr-1" />
                    付款 {money(row.amount)}
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
          busy={false}
          error={error}
          submitDisabled={!projectId || !amount || !!labAmountError(amount, { min: "0.01", unit: "元" })}
          onClose={() => {
            setPublishing(false);
            setAmount("");
          }}
          onSubmit={async (form) => {
            try {
              await store.request("cash-bounties/", "POST", {
                project_id: projectId,
                title: form.get("title"),
                amount: form.get("amount"),
                deliverable: form.get("deliverable"),
                criteria: form.get("criteria"),
                due_at: form.get("due_at") || null,
              });
              await mutate();
              setPublishing(false);
              setAmount("");
              setView(currentProject?.lead ? "open" : "mine");
              setNotice(currentProject?.lead ? "现金悬赏已发布。" : "现金悬赏提议已提交，等待负责人审批。");
            } catch (problem) {
              setError(problem instanceof Error ? problem.message : "发布失败");
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
          <LabField label="任务名称">
            <input name="title" className={labInputClass} required maxLength={255} placeholder="例如：装配 2 台样机" />
          </LabField>
          <LabField label="现金赏金（元）">
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
              placeholder="做完什么、交什么东西"
            />
          </LabField>
          <LabField label="验收标准（可选）">
            <textarea name="criteria" className={labInputClass} rows={2} placeholder="怎么算通过" />
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
            await act(submitting, "submit", { evidence: String(form.get("evidence") ?? "") });
            setSubmitting(undefined);
          }}
        >
          <LabField label="成果、链接或交付说明">
            <textarea name="evidence" className={labInputClass} rows={5} required />
          </LabField>
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

      {accepting && (
        <LabDialog
          title="验收并付款"
          submitLabel="验收并付款"
          busy={busyId === accepting.id}
          error={error}
          onClose={() => setAccepting(undefined)}
          onSubmit={async (form) => {
            await acceptAndPay(accepting, String(form.get("note") ?? ""));
          }}
        >
          <p className="text-13">
            确认「{accepting.title}」已按约定完成，通过后将从项目已到账资金支付{" "}
            <strong>{money(accepting.amount)}</strong>。
          </p>
          <LabField label="验收意见（可选）">
            <textarea name="note" className={labInputClass} rows={3} placeholder="例如：成果已收到，符合要求" />
          </LabField>
        </LabDialog>
      )}
    </div>
  );
}
