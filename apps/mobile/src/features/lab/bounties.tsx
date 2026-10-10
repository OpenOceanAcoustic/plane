/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { CanonicalIcon } from "../../components/navigation";
import { Html, PageHeading } from "../../components/ui";
import type { LabBounty, LabTodo, LabBountyMaterial, LabMember } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { LabBountyPublish } from "./bounty-publish";
import { workflowActionBody, acceptanceLabels } from "./workflow-types";
import type { LabWorkflow, LabWorkflowAction } from "./workflow-types";
import { newRequestKey } from "./business";
import { calendarInstant } from "./calendar-time";
import {
  Button,
  LabDialog,
  LabDetail,
  LabField,
  Empty,
  ErrorMessage,
  KeyValues,
  LabAmountInput,
  labAmountError,
  labDecimalUnits,
  labDecimalText,
} from "./ui";
const statusNames: Record<string, string> = {
  draft: "草稿",
  publication_review: "发布待复核",
  open: "开放认领",
  active: "进行中",
  review: "待验收",
  acceptance_review: "验收待复核",
  partial: "部分通过",
  rework: "返工",
  rejected: "不通过",
  done: "完成",
  cancelled: "已取消",
};
type Sources = {
  document_versions: { id: string; name: string; created_at: string }[];
  attachments: { id: string; name: string }[];
};
type SharedDocument = { name: string; description_html: string; created_at: string };
export function Bounties({
  store,
  initialId = "",
  onOpenIssue,
  onDownload,
  onCloseDetail,
}: {
  store: LabStore;
  initialId?: string;
  onOpenIssue?: (project: string, issue: string) => void;
  onDownload?: (path: string, name: string) => Promise<void>;
  onCloseDetail?: () => void;
}) {
  const [view, setView] = useState("open");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [publish, setPublish] = useState(false);
  const [selected, setSelected] = useState(initialId);
  const closeDetail = () => {
    setSelected("");
    onCloseDetail?.();
  };
  const [publicSummary, setPublicSummary] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exception, setException] = useState(false);
  const [exceptions, setExceptions] = useState(false);
  const list = useResource<LabBounty[]>(store, "bounties/");
  const todos = useResource<LabTodo[]>(store, "inbox/");
  const detail = useResource<LabBounty>(store, selected ? `bounties/${selected}/detail/` : null);
  const flow = useResource<LabWorkflow>(store, selected ? `bounties/${selected}/workflow/` : null);
  const materials = useResource<{ materials: LabBountyMaterial[]; sources?: Sources }>(
    store,
    detail.data ? `bounties/${selected}/materials/${detail.data.can_manage_materials ? "?sources=1" : ""}` : null
  );
  const wip = useResource<
    {
      id: string;
      name: string;
      reason: string;
      expires_at: string;
      active_limit: number;
      major_limit: number;
      approver: string;
    }[]
  >(store, exceptions ? "wip-exceptions/" : null);
  const [chosen, setChosen] = useState<{ action: LabWorkflowAction; requestKey: string }>();
  const [planned, setPlanned] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [result, setResult] = useState("pass");
  const [sharing, setSharing] = useState(false);
  const [shareKind, setShareKind] = useState("document_version");
  const [viewed, setViewed] = useState<SharedDocument>();
  const [readError, setReadError] = useState("");
  const [revoking, setRevoking] = useState<LabBountyMaterial>();
  const bounty = detail.data;
  const refresh = async () => {
    await Promise.all([
      list.refresh(),
      todos.refresh(),
      store.loadMarket(),
      store.loadPlanner(),
      ...(selected ? [detail.refresh(), flow.refresh(), materials.refresh()] : []),
    ]);
  };
  const openAction = (action: LabWorkflowAction) => {
    setPlanned("");
    setTargets(
      Object.fromEntries((bounty?.allocations ?? []).filter((row) => row.approved).map((row) => [row.id, row.planned]))
    );
    setResult("pass");
    setChosen({ action, requestKey: newRequestKey() });
  };
  const claimLimit =
    bounty?.claim_available ??
    (bounty
      ? labDecimalText(
          (labDecimalUnits(bounty.budget) ?? 0n) -
            bounty.allocations
              .filter((row) => row.approved)
              .reduce((sum, row) => sum + (labDecimalUnits(row.planned) ?? 0n), 0n)
        )
      : undefined);
  const approved = bounty?.allocations.filter((row) => row.approved) ?? [];
  const targetTotal = approved.reduce((sum, row) => sum + (labDecimalUnits(targets[row.id] ?? "") ?? 0n), 0n);
  const invalid =
    chosen?.action.action === "claim"
      ? !!labAmountError(planned, { limit: claimLimit, min: "0.01", unit: "VC" })
      : chosen?.action.action === "accept" && !["rework", "reject"].includes(result)
        ? approved.some(
            (row) =>
              !!labAmountError(targets[row.id] ?? "", {
                limit: row.planned,
                min: ["pass", "negative"].includes(result) ? row.planned : row.awarded,
                unit: "VC",
              })
          ) || targetTotal > (labDecimalUnits(bounty?.budget ?? "0") ?? 0n)
        : false;
  const visibleBounties = (list.data ?? []).filter(
    (row) =>
      (!project || row.project_id === project) &&
      (view !== "open" || row.status === "open") &&
      (view !== "mine" ||
        row.allocations.some((allocation) => allocation.user_id === store.planner?.user_id) ||
        row.is_lead ||
        row.is_reviewer ||
        row.is_independent_reviewer) &&
      `${row.title} ${row.public_summary} ${row.deliverable}`.toLowerCase().includes(query.toLowerCase())
  );
  const projectChoices = Array.from(
    new Map(
      [
        ...(store.planner?.projects ?? []).map((row) => ({ id: row.id, name: row.name })),
        ...(list.data ?? []).map((row) => ({ id: row.project_id, name: row.project })),
      ].map((row) => [row.id, row])
    ).values()
  );
  return (
    <>
      {!selected && (
        <>
          <PageHeading title="悬赏大厅">
            <button className="icon-button" onClick={() => void refresh().catch(() => {})} aria-label="刷新悬赏列表">
              <CanonicalIcon name="refresh" size={24} />
            </button>
          </PageHeading>
          <main className="bx-body bx-market-body">
            <ErrorMessage error={list.error || todos.error || detail.error || flow.error || store.error} />
            <label className="bx-search">
              <CanonicalIcon name="search" size={24} />
              <input
                type="search"
                aria-label="搜索任务、交付物"
                placeholder="搜索任务、交付物"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="bx-market-filters">
              <label className="bx-scope-filter m3-chip v6-select-chip">
                <span>{projectChoices.find((row) => row.id === project)?.name ?? "全实验室公开悬赏"}</span>
                <CanonicalIcon name="down" size={18} />
                <select aria-label="悬赏项目" value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">全实验室公开悬赏</option>
                  {projectChoices.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="bx-wip-filter m3-chip" onClick={() => setExceptions(true)}>
                WIP 例外
              </button>
            </div>
            <div className="m3-tabs bx-tabs bx-market-tabs" role="tablist">
              {[
                { id: "open", name: "开放认领" },
                { id: "mine", name: "我的参与" },
                { id: "all", name: "全部悬赏" },
              ].map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={view === item.id}
                  className={`bx-tab${view === item.id ? " bx-selected" : ""}`}
                  onClick={() => setView(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="bx-market-section">
              <h2>{view === "open" ? "开放认领" : view === "mine" ? "我的参与" : "全部悬赏"}</h2>
              <span>{visibleBounties.length} 项</span>
            </div>
            {visibleBounties.map((row) => (
              <article className="bx-bounty-card" key={row.id}>
                <div className="bx-bounty-top">
                  <span>
                    <CanonicalIcon name="folder" size={18} />
                    {row.project}
                  </span>
                  <span className="bx-bounty-status">{statusNames[row.status] ?? row.status}</span>
                </div>
                <h3>{row.title}</h3>
                <div className="bx-bounty-values">
                  <div>
                    <span>VC 配额</span>
                    <strong>
                      {row.budget}
                      <small>VC</small>
                    </strong>
                  </div>
                  <div>
                    <span>预算预计</span>
                    <strong className="bx-estimate">
                      {(row.estimated_reward ?? row.reward_estimate?.amount)
                        ? `¥${row.estimated_reward ?? row.reward_estimate?.amount}`
                        : "—"}
                    </strong>
                  </div>
                </div>
                {row.due_at && (
                  <div className="lab-card-meta">
                    <span>{row.due_at.slice(0, 10)} 截止</span>
                  </div>
                )}
                <button className="bx-bounty-open" onClick={() => setSelected(row.id)}>
                  <span>查看悬赏</span>
                  <CanonicalIcon name="arrow" size={24} />
                </button>
              </article>
            ))}
            {list.loading && <Empty>正在读取悬赏…</Empty>}
            {list.data && !visibleBounties.length && <Empty>所选范围暂无悬赏。</Empty>}
            {!!todos.data?.length && (
              <details className="v6-finance-records">
                <summary>
                  我的待办
                  <CanonicalIcon name="down" size={18} />
                </summary>
                <div className="lab-action-list">
                  {todos.data.map((row) => (
                    <button key={row.id} className="lab-action-row" onClick={() => setSelected(row.id)}>
                      <span>
                        {row.action} · {row.title}
                        {row.overdue ? " · 已逾期" : ""}
                      </span>
                      <CanonicalIcon name="chevron" size={20} />
                    </button>
                  ))}
                </div>
              </details>
            )}
          </main>
          {store.planner?.projects.some((row) => row.lead) && (
            <button className="m3-fab bx-create-bounty" onClick={() => setPublish(true)}>
              <CanonicalIcon name="plus" size={24} />
              <span>新建悬赏</span>
            </button>
          )}
        </>
      )}
      {selected && (
        <LabDetail title="悬赏详情" onClose={closeDetail}>
          <ErrorMessage error={detail.error || flow.error || store.error} />
          {!bounty && !detail.error && <Empty>正在读取悬赏详情…</Empty>}
          {bounty && (
            <>
              <article className="lab-card">
                <div className="lab-heading">
                  <small className="lab-muted">{bounty.issue_key ?? "悬赏任务"}</small>
                  <span className={`lab-badge ${bounty.status}`}>{statusNames[bounty.status] ?? bounty.status}</span>
                </div>
                <h3>{bounty.title}</h3>
                <p className="lab-muted">{bounty.project}</p>
                <div className="lab-card-meta">
                  {bounty.major && <span>重大任务</span>}
                  {bounty.category_name && <span>{bounty.category_name}</span>}
                </div>
              </article>
              {bounty.public_summary && <p className="lab-item-description">{bounty.public_summary}</p>}
              {bounty.access_level === "public" ? (
                <div className="lab-hero">
                  <span>VC 配额</span>
                  <strong>{bounty.budget} VC</strong>
                </div>
              ) : (
                <div className="lab-stats two">
                  <div className="lab-stat">
                    <span>VC 配额</span>
                    <strong>{bounty.budget} VC</strong>
                  </div>
                  <div className="lab-stat">
                    <span>已授予</span>
                    <strong>{bounty.awarded ?? "0.00"} VC</strong>
                  </div>
                </div>
              )}
              <KeyValues
                values={{
                  预算预计奖励: bounty.estimated_reward ?? bounty.reward_estimate?.amount,
                  到账奖励测算: bounty.received_estimate?.amount,
                  公式版本: bounty.reward_formula_version ?? bounty.reward_estimate?.formula_version,
                  剩余可认领: bounty.claim_available,
                  截止日期: bounty.due_at,
                  重大原因: bounty.major_reasons.join("；"),
                }}
              />
              <section>
                <h3 className="lab-section-heading">{bounty.access_level === "public" ? "公开交付要求" : "交付物"}</h3>
                <div className="lab-editor-block">
                  <p className="lab-item-description">{bounty.deliverable}</p>
                </div>
              </section>
              <section>
                <h3 className="lab-section-heading">
                  {bounty.access_level === "public" ? "公开验收条件" : "验收条件"}
                </h3>
                <div className="lab-editor-block">
                  <p className="lab-item-description">{bounty.criteria}</p>
                </div>
              </section>
              {bounty.evidence && (
                <section>
                  <h3 className="lab-section-heading">提交成果</h3>
                  <p className="lab-item-description">{bounty.evidence}</p>
                </section>
              )}
              {bounty.issue_id && bounty.access_level === "project" && onOpenIssue && (
                <Button onClick={() => onOpenIssue(bounty.project_id, bounty.issue_id!)}>打开项目任务</Button>
              )}
              <h3 className="lab-section-heading">团队分工</h3>
              {bounty.allocations.map((row) => (
                <article className="lab-card" key={row.id}>
                  <h3>{row.name}</h3>
                  <p className="lab-muted">{row.deliverable}</p>
                  <div className="lab-card-meta">
                    <span>
                      {row.awarded} / {row.planned} VC
                    </span>
                    <span>{row.approved ? "已核准" : "待核准"}</span>
                    <span>{row.confirmed ? "已确认" : "待确认"}</span>
                    <span>{row.closed ? "已结束" : "进行中"}</span>
                  </div>
                </article>
              ))}
              <h3 className="lab-section-heading">执行资料与流程</h3>
              <details className="lab-disclosure">
                <summary>执行资料 · {materials.data?.materials.length ?? 0}</summary>
                <ErrorMessage error={materials.error || readError} />
                {bounty.can_manage_materials && <Button onClick={() => setSharing(true)}>共享文档版本或附件</Button>}
                {materials.data?.materials.map((row) => (
                  <article className="lab-card" key={row.id}>
                    <h3>{row.label}</h3>
                    <small className="lab-muted">{row.kind === "document_version" ? "冻结文档版本" : "附件"}</small>
                    <div className="lab-actions">
                      <Button
                        onClick={() => {
                          setReadError("");
                          const path = `/api/workspaces/${encodeURIComponent(store.slug)}/lab/bounties/${selected}/materials/${row.id}/`;
                          void (
                            row.kind === "document_version"
                              ? store
                                  .request<SharedDocument>(`bounties/${selected}/materials/${row.id}/`)
                                  .then(setViewed)
                              : onDownload
                                ? onDownload(path, row.label)
                                : Promise.reject(new Error("附件下载服务尚未初始化"))
                          ).catch((e) => setReadError(e instanceof Error ? e.message : "资料读取失败"));
                        }}
                      >
                        打开资料
                      </Button>
                      {bounty.can_manage_materials && <Button onClick={() => setRevoking(row)}>撤回共享</Button>}
                    </div>
                  </article>
                ))}
                {materials.data && !materials.data.materials.length && <Empty>尚无共享资料</Empty>}
              </details>
              <details className="lab-disclosure">
                <summary>验收记录 · {bounty.acceptances.length}</summary>
                {bounty.acceptances.map((row) => (
                  <article className="lab-card" key={row.id}>
                    <h3>{acceptanceLabels[row.result]}</h3>
                    <KeyValues values={{ 验收人: row.reviewer, 原因: row.reason, 复核时间: row.approved_at }} />
                    {Object.entries(row.targets).map(([id, value]) => (
                      <p key={id}>
                        {bounty.allocations.find((a) => a.id === id)?.name ?? "参与者"}：{value} VC
                      </p>
                    ))}
                  </article>
                ))}
              </details>
              <details className="lab-disclosure">
                <summary>团队悬赏流程</summary>
                {flow.data?.nodes.map((row) => (
                  <article key={row.id} className="lab-timeline-row">
                    <h3>{row.label}</h3>
                    <small className="lab-muted">
                      {row.state === "current" ? "当前阶段" : row.state === "completed" ? "已完成" : "待发生"}
                    </small>
                    <div className="lab-actions">
                      {flow.data?.actions
                        .filter((action) => action.node_id === row.id)
                        .map((action) => (
                          <Button
                            key={action.id}
                            disabled={!action.enabled}
                            title={action.reason}
                            onClick={() => openAction(action)}
                          >
                            {action.label}
                          </Button>
                        ))}
                    </div>
                  </article>
                ))}
                {flow.data?.history
                  .slice()
                  // oxlint-disable-next-line unicorn/no-array-reverse -- ES2022 target; reverses a new local copy
                  .reverse()
                  .map((row) => (
                    <article className="lab-card" key={row.id}>
                      <h3>{row.label}</h3>
                      <KeyValues values={{ 处理人: row.actor, 时间: row.created_at, 依据: row.reason }} />
                    </article>
                  ))}
              </details>
              <div className="lab-actions">
                {flow.data?.actions
                  .filter(
                    (action) =>
                      action.enabled &&
                      [
                        "claim",
                        "submit",
                        "accept",
                        "start",
                        "approve",
                        "confirm",
                        "publication-review",
                        "acceptance-review",
                      ].includes(action.action)
                  )
                  .map((action) => (
                    <Button key={action.id} variant="primary" onClick={() => openAction(action)}>
                      {action.label}
                    </Button>
                  ))}
              </div>
              {bounty.is_lead && <Button onClick={() => setPublicSummary(true)}>编辑公开摘要</Button>}
              {bounty.can_delete && <Button onClick={() => setDeleting(true)}>删除悬赏</Button>}
            </>
          )}
        </LabDetail>
      )}
      {chosen && bounty && (
        <LabDialog
          title={chosen.action.label}
          submitDisabled={invalid}
          onClose={() => setChosen(undefined)}
          onSubmit={async (form) => {
            const body = workflowActionBody(chosen.action, form, bounty, result, chosen.requestKey);
            await store.request(
              chosen.action.action === "reverse"
                ? `ledger/${chosen.action.body.ledger_id}/reverse/`
                : `bounties/${bounty.id}/${chosen.action.action}/`,
              "POST",
              body
            );
            await refresh();
            setChosen(undefined);
          }}
        >
          {chosen.action.action === "claim" && (
            <>
              <LabField label="本人交付物">
                <textarea name="deliverable" required />
              </LabField>
              <LabField label="计划 VC">
                <LabAmountInput
                  name="planned"
                  value={planned}
                  onValueChange={setPlanned}
                  limit={claimLimit}
                  min="0.01"
                  unit="VC"
                  required
                />
              </LabField>
            </>
          )}
          {chosen.action.action === "submit" && (
            <LabField label="成果与证据引用">
              <textarea name="evidence" required defaultValue={bounty.evidence} />
            </LabField>
          )}
          {chosen.action.action === "accept" && (
            <>
              <LabField label="验收结果">
                <select value={result} onChange={(e) => setResult(e.target.value)}>
                  {Object.entries(acceptanceLabels).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </LabField>
              {!["rework", "reject"].includes(result) &&
                approved.map((row) => (
                  <LabField
                    key={row.id}
                    label={`${row.name} 累计通过 VC（已授予 ${row.awarded}，计划 ${row.planned}）`}
                  >
                    <LabAmountInput
                      name={row.id}
                      value={targets[row.id] ?? ""}
                      onValueChange={(value) => setTargets({ ...targets, [row.id]: value })}
                      min={["pass", "negative"].includes(result) ? row.planned : row.awarded}
                      limit={row.planned}
                      unit="VC"
                      required
                    />
                  </LabField>
                ))}
              {targetTotal > (labDecimalUnits(bounty.budget) ?? 0n) && (
                <ErrorMessage error="累计通过 VC 超出悬赏配额" />
              )}
            </>
          )}
          {["accept", "publication-review", "acceptance-review", "cancel", "reopen", "reverse"].includes(
            chosen.action.action
          ) && (
            <LabField label="处理意见">
              <textarea name="reason" required />
            </LabField>
          )}
          {["start", "approve", "confirm"].includes(chosen.action.action) && <p>确认执行“{chosen.action.label}”？</p>}
        </LabDialog>
      )}
      {publish && (
        <LabBountyPublish
          store={store}
          onClose={() => setPublish(false)}
          onPublished={refresh}
          initialProjectId={project}
        />
      )}
      {publicSummary && bounty && (
        <LabDialog
          title="编辑公开摘要"
          onClose={() => setPublicSummary(false)}
          onSubmit={async (form) => {
            await store.request(`bounties/${bounty.id}/public-summary/`, "POST", {
              public_summary: form.get("public_summary"),
              public_deliverable: form.get("public_deliverable"),
              public_criteria: form.get("public_criteria"),
              enabled: form.get("enabled") === "on",
              reason: form.get("reason"),
            });
            await refresh();
            setPublicSummary(false);
          }}
        >
          <LabField label="公开摘要">
            <textarea name="public_summary" required defaultValue={bounty.public_summary} />
          </LabField>
          <LabField label="公开交付物">
            <textarea name="public_deliverable" required defaultValue={bounty.deliverable} />
          </LabField>
          <LabField label="公开验收标准">
            <textarea name="public_criteria" required defaultValue={bounty.criteria} />
          </LabField>
          <label>
            <input type="checkbox" name="enabled" defaultChecked />
            在全实验室悬赏大厅公开
          </label>
          <LabField label="更新原因">
            <textarea name="reason" required />
          </LabField>
        </LabDialog>
      )}
      {deleting && bounty && (
        <LabDialog
          title="删除悬赏"
          destructive
          onClose={() => setDeleting(false)}
          onSubmit={async (form) => {
            await store.request(`bounties/${bounty.id}/detail/`, "DELETE", { reason: form.get("reason") });
            setDeleting(false);
            closeDetail();
            await list.refresh();
            await todos.refresh();
            await store.loadPlanner();
          }}
        >
          <LabField label="删除原因">
            <textarea name="reason" required />
          </LabField>
        </LabDialog>
      )}
      {sharing && bounty && (
        <LabDialog
          title="共享执行资料"
          onClose={() => setSharing(false)}
          onSubmit={async (form) => {
            await store.request(`bounties/${bounty.id}/materials/`, "POST", {
              kind: shareKind,
              label: form.get("label"),
              [shareKind === "document_version" ? "page_version_id" : "attachment_id"]: form.get("source_id"),
            });
            await materials.refresh();
            setSharing(false);
          }}
        >
          <LabField label="类型">
            <select value={shareKind} onChange={(e) => setShareKind(e.target.value)}>
              <option value="document_version">冻结文档版本</option>
              <option value="attachment">任务附件</option>
            </select>
          </LabField>
          <LabField label="具体资料">
            <select name="source_id" required>
              <option value="">请选择</option>
              {(shareKind === "document_version"
                ? materials.data?.sources?.document_versions
                : materials.data?.sources?.attachments
              )?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="资料名称">
            <input name="label" maxLength={255} />
          </LabField>
        </LabDialog>
      )}
      {viewed && (
        <LabDialog title={viewed.name} onClose={() => setViewed(undefined)}>
          <p className="lab-muted">冻结版本 · {viewed.created_at}</p>
          <Html html={viewed.description_html} />
        </LabDialog>
      )}
      {revoking && (
        <LabDialog
          title="撤回共享资料"
          destructive
          onClose={() => setRevoking(undefined)}
          onSubmit={async () => {
            await store.request(`bounties/${selected}/materials/${revoking.id}/`, "DELETE");
            await materials.refresh();
            setRevoking(undefined);
          }}
        >
          <p>确认撤回“{revoking.label}”？参与者将无法继续访问。</p>
        </LabDialog>
      )}
      {exceptions && (
        <LabDialog title="WIP 例外" onClose={() => setExceptions(false)}>
          <ErrorMessage error={wip.error} />
          {store.planner?.team_access && <Button onClick={() => setException(true)}>批准例外</Button>}
          {wip.data?.map((row) => (
            <article className="lab-card" key={row.id}>
              <h3>{row.name}</h3>
              <KeyValues
                values={{
                  原因: row.reason,
                  批准人: row.approver,
                  截止: row.expires_at,
                  进行上限: row.active_limit,
                  重大上限: row.major_limit,
                }}
              />
            </article>
          ))}
          {wip.data && !wip.data.length && <Empty />}
        </LabDialog>
      )}
      {exception && (
        <LabDialog
          title="批准 WIP 例外"
          onClose={() => setException(false)}
          onSubmit={async (form) => {
            await store.request("wip-exceptions/", "POST", {
              user_id: form.get("user_id"),
              reason: form.get("reason"),
              expires_at: calendarInstant(String(form.get("expires_at"))),
              active_limit: Number(form.get("active_limit")),
              major_limit: Number(form.get("major_limit")),
            });
            await wip.refresh();
            setException(false);
          }}
        >
          <LabField label="成员">
            <select name="user_id" required>
              <option value="">请选择</option>
              {Array.from(
                new Map(
                  (store.planner?.projects ?? [])
                    .flatMap((row) => row.members)
                    .filter((row) => row.id !== store.planner?.user_id)
                    .map((row) => [row.id, row])
                ).values()
              ).map((row: LabMember) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="截止时间（上海，90天内）">
            <input type="datetime-local" name="expires_at" required />
          </LabField>
          <LabField label="进行中上限">
            <input type="number" name="active_limit" min={2} max={10} defaultValue={2} required />
          </LabField>
          <LabField label="重大事项上限">
            <input type="number" name="major_limit" min={1} max={5} defaultValue={1} required />
          </LabField>
          <LabField label="批准原因">
            <textarea name="reason" required />
          </LabField>
        </LabDialog>
      )}
    </>
  );
}
