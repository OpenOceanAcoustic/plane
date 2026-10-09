/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
import { v4 as uuidv4 } from "uuid";
import { useSWRConfig } from "swr";
import { Button, LabBountyBadge, labBountyOutline } from "@plane/ui";
import type { LabBounty } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";
import { LabBountyWorkflow } from "./workflow";
import { LabBountyMaterials } from "./bounty-materials";
import { LabBountyPublish } from "./bounty-publish";

const labels: Record<string, string> = {
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

export const LabMarket = observer(function LabMarket({ store }: { store: LabStore }) {
  const { mutate } = useSWRConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailId = searchParams.get("bounty_id") ?? searchParams.get("bounty") ?? "";
  const [view, setView] = useState<"open" | "mine" | "all">("open");
  const [mode, setMode] = useState<"publish" | "claim" | "submit" | "accept" | "public-summary">();
  const [chosen, setChosen] = useState<LabBounty>();
  const [projectFilter, setProjectFilter] = useState("");
  const [result, setResult] = useState("pass");
  const [acceptanceKey, setAcceptanceKey] = useState("");
  const [workflowIds, setWorkflowIds] = useState<Set<string>>(new Set());
  const [reasonAction, setReasonAction] = useState<{
    bounty: LabBounty;
    action: string;
    extra: Record<string, string>;
  }>();
  const [deleting, setDeleting] = useState<LabBounty>();
  useEffect(() => {
    void store.execute(store.loadMarket);
  }, [store]);
  useEffect(() => {
    if (detailId)
      void store.execute(async () => {
        await store.loadBountyDetail(detailId);
      });
  }, [detailId, store]);
  const openDetail = (id: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("bounty_id", id);
      next.delete("bounty");
      return next;
    });
  };
  const planner = store.planner;
  if (!planner) return null;
  const close = () => {
    setMode(undefined);
    setChosen(undefined);
  };
  async function act(bounty: LabBounty, action: string, body: unknown = {}) {
    await store.execute(async () => {
      await store.request(`bounties/${bounty.id}/${action}/`, "POST", body);
      await store.loadMarket();
      await store.loadPlanner();
    });
  }
  async function finish(action: () => Promise<void>) {
    await store.execute(async () => {
      await action();
      await store.loadMarket();
      await store.loadPlanner();
      close();
    });
  }
  const actionReason = (bounty: LabBounty, action: string, extra: Record<string, string> = {}) => {
    setReasonAction({ bounty, action, extra });
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!planner.projects.some((project) => project.lead)} onClick={() => setMode("publish")}>
          发布悬赏
        </Button>
        <select
          aria-label="按项目查看"
          className={`${labInputClass} ml-auto max-w-48`}
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          <option value="">全实验室公开悬赏</option>
          {Array.from(
            new Map(
              [
                ...planner.projects,
                ...store.bounties.map((bounty) => ({ id: bounty.project_id, name: bounty.project })),
              ].map((project) => [project.id, project])
            ).values()
          ).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {store.todos.length > 0 && (
        <section className="rounded-md border border-subtle bg-layer-1 p-4">
          <h2 className="mb-2 text-14 font-semibold">我的待办</h2>
          <div className="flex flex-wrap gap-2">
            {store.todos.map((todo) => (
              <button
                key={todo.id}
                type="button"
                onClick={() => openDetail(todo.id)}
                className="rounded border border-subtle bg-surface-1 px-3 py-2 text-12"
              >
                {todo.action} · {todo.title}
                {todo.overdue ? " · 已逾期" : ""}
              </button>
            ))}
          </div>
        </section>
      )}
      <nav aria-label="悬赏筛选" className="flex gap-2">
        {(
          [
            { id: "open", name: "开放认领" },
            { id: "mine", name: "我的参与" },
            { id: "all", name: "全部悬赏" },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.id}
            size="sm"
            variant={view === tab.id ? "primary" : "neutral-primary"}
            onClick={() => setView(tab.id)}
          >
            {tab.name}
          </Button>
        ))}
      </nav>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="悬赏工作项卡片">
        {store.bounties
          .filter(
            (row) =>
              (!projectFilter || row.project_id === projectFilter) &&
              (view === "all" ||
                (view === "open" && row.status === "open") ||
                (view === "mine" && row.allocations.some((allocation) => allocation.user_id === planner.user_id)))
          )
          .map((bounty) => (
            <button
              key={bounty.id}
              type="button"
              onClick={() => openDetail(bounty.id)}
              style={labBountyOutline(bounty.category_color)}
              className={`rounded-lg border bg-surface-1 p-4 text-left ${detailId === bounty.id ? "ring-accent-primary ring-2" : ""}`}
              aria-label={`查看悬赏 ${bounty.title}`}
            >
              <div className="flex items-center gap-2 text-12">
                <LabBountyBadge color={bounty.category_color} />
                <span className="ml-auto text-secondary">{labels[bounty.status] ?? bounty.status}</span>
              </div>
              <p className="mt-2 text-12 text-secondary">
                {bounty.project}
                {bounty.issue_key ? ` · ${bounty.issue_key}` : ""}
                {bounty.major ? " · 重大任务" : ""}
              </p>
              <h2 className="mt-1 line-clamp-2 text-14 font-semibold">{bounty.title}</h2>
              <p className="mt-2 line-clamp-2 text-12 text-secondary">{bounty.public_summary || bounty.deliverable}</p>
              <p className="mt-3 text-12">VC 配额 {bounty.budget}</p>
              <p className="mt-1 text-12 text-accent-primary">
                {(bounty.reward_estimate?.amount ?? bounty.estimated_reward)
                  ? `预计 ¥${bounty.reward_estimate?.amount ?? bounty.estimated_reward} · 公式 v${bounty.reward_estimate?.formula_version ?? bounty.reward_formula_version ?? "—"}`
                  : bounty.reward_estimate?.error || "预计奖励待负责人配置"}
              </p>
            </button>
          ))}
      </div>
      {detailId && (
        <div className="flex items-center justify-between">
          <h2 className="text-16 font-semibold">悬赏任务详情</h2>
          <Button
            size="sm"
            variant="neutral-primary"
            onClick={() =>
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.delete("bounty_id");
                next.delete("bounty");
                return next;
              })
            }
          >
            关闭任务详情
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        {store.bounties
          .filter((row) => row.id === detailId)
          .map((bounty) => {
            const mine = bounty.allocations.find((row) => row.user_id === planner.user_id);
            return (
              <article
                key={bounty.id}
                id={`bounty-${bounty.id}`}
                className="scroll-mt-4 rounded-lg border bg-surface-1 p-5"
                style={labBountyOutline(bounty.category_color)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="mb-1 text-12 text-tertiary">
                      {bounty.project}
                      {bounty.major ? " · 重大任务" : ""}
                    </p>
                    <h2 className="text-16 font-semibold">
                      {bounty.issue_id && bounty.access_level === "project" ? (
                        <a href={`/${store.slug}/projects/${bounty.project_id}/issues/${bounty.issue_id}`}>
                          {bounty.title}
                        </a>
                      ) : (
                        bounty.title
                      )}
                    </h2>
                  </div>
                  <LabBountyBadge color={bounty.category_color} />
                  <span className="rounded bg-layer-1 px-2 py-1 text-12">{labels[bounty.status] ?? bounty.status}</span>
                </div>
                <p className="mt-3 text-13">
                  VC 配额 {bounty.budget}
                  {bounty.awarded !== null ? ` · 已授予 ${bounty.awarded}` : ""}
                </p>
                {bounty.reward_estimate && (
                  <p className="mt-2 text-13">
                    预算预计奖励{" "}
                    {bounty.reward_estimate.amount === null
                      ? bounty.reward_estimate.error || "待配置"
                      : `¥${bounty.reward_estimate.amount}`}{" "}
                    · 公式 v{bounty.reward_estimate.formula_version ?? "—"}（参考）
                  </p>
                )}
                {bounty.received_estimate && (
                  <p className="mt-1 text-13">
                    到账奖励测算{" "}
                    {bounty.received_estimate.amount === null
                      ? bounty.received_estimate.error || "待计算"
                      : `¥${bounty.received_estimate.amount}`}{" "}
                    · 公式 v{bounty.received_estimate.formula_version ?? "—"}（参考）
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-[64px_1fr] gap-2 text-13">
                  <dt className="text-tertiary">交付物</dt>
                  <dd className="whitespace-pre-wrap">{bounty.deliverable}</dd>
                  <dt className="text-tertiary">验收条件</dt>
                  <dd className="whitespace-pre-wrap">{bounty.criteria}</dd>
                  {bounty.evidence && (
                    <>
                      <dt className="text-tertiary">成果证据</dt>
                      <dd className="whitespace-pre-wrap">{bounty.evidence}</dd>
                    </>
                  )}
                </dl>
                {bounty.overdue && <p className="text-orange-600 mt-2 text-12">验收已逾期，请验收人处理。</p>}
                <div className="my-4 flex flex-col gap-2">
                  {bounty.allocations.map((allocation) => (
                    <div key={allocation.id} className="rounded bg-layer-1 p-3 text-12">
                      <div className="flex items-center gap-2">
                        <strong>{allocation.name}</strong>
                        <span>
                          {allocation.awarded}/{allocation.planned} VC ·{" "}
                          {allocation.closed
                            ? "已完成"
                            : allocation.confirmed
                              ? "已确认"
                              : allocation.approved
                                ? "待本人确认"
                                : "待负责人批准"}
                        </span>
                        {bounty.is_lead && !allocation.approved && bounty.status === "open" && (
                          <Button
                            size="sm"
                            variant="neutral-primary"
                            onClick={() => void act(bounty, "approve", { allocation_id: allocation.id })}
                          >
                            批准
                          </Button>
                        )}
                      </div>
                      <p className="mt-1 text-secondary">{allocation.deliverable}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {bounty.is_lead && (
                    <Button
                      size="sm"
                      variant="neutral-primary"
                      onClick={() => {
                        setChosen(bounty);
                        setMode("public-summary");
                      }}
                    >
                      公开摘要设置
                    </Button>
                  )}
                  {(bounty.can_delete ?? bounty.is_lead) && bounty.status !== "deleted" && (
                    <Button
                      size="sm"
                      variant="neutral-primary"
                      disabled={store.busy}
                      onClick={() => setDeleting(bounty)}
                    >
                      删除悬赏
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    onClick={() =>
                      setWorkflowIds((previous) => {
                        const next = new Set(previous);
                        if (next.has(bounty.id)) next.delete(bounty.id);
                        else next.add(bounty.id);
                        return next;
                      })
                    }
                  >
                    {workflowIds.has(bounty.id) ? "收起流程" : "查看流程图"}
                  </Button>
                  {(bounty.can_claim ??
                    (bounty.status === "open" && !mine && !bounty.is_reviewer && !bounty.is_independent_reviewer)) && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setChosen(bounty);
                        setMode("claim");
                      }}
                    >
                      申请认领
                    </Button>
                  )}
                  {(bounty.can_confirm ?? (bounty.status === "open" && mine?.approved && !mine.confirmed)) && (
                    <Button size="sm" onClick={() => void act(bounty, "confirm")}>
                      确认交付约定
                    </Button>
                  )}
                  {bounty.status === "open" && bounty.is_lead && (
                    <Button size="sm" onClick={() => void act(bounty, "start")}>
                      团队开工
                    </Button>
                  )}
                  {(bounty.can_submit ??
                    (mine?.approved && !mine.closed && ["active", "rework", "partial"].includes(bounty.status))) && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setChosen(bounty);
                        setMode("submit");
                      }}
                    >
                      提交成果验收
                    </Button>
                  )}
                  {bounty.status === "review" && bounty.is_reviewer && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setChosen(bounty);
                        setResult("pass");
                        setAcceptanceKey(uuidv4());
                        setMode("accept");
                      }}
                    >
                      独立验收
                    </Button>
                  )}
                  {bounty.status === "publication_review" && bounty.is_independent_reviewer && (
                    <Button size="sm" onClick={() => actionReason(bounty, "publication-review")}>
                      复核发布
                    </Button>
                  )}
                  {bounty.status === "acceptance_review" && bounty.is_independent_reviewer && (
                    <Button
                      size="sm"
                      onClick={() =>
                        actionReason(bounty, "acceptance-review", {
                          acceptance_id: bounty.acceptances.find((row) => !row.approved_at)?.id ?? "",
                        })
                      }
                    >
                      复核验收
                    </Button>
                  )}
                  {bounty.is_lead && !["done", "cancelled", "rejected"].includes(bounty.status) && (
                    <Button size="sm" variant="neutral-primary" onClick={() => actionReason(bounty, "cancel")}>
                      取消并释放未授予预算
                    </Button>
                  )}
                  {bounty.is_lead &&
                    ["done", "active", "partial", "rework"].includes(bounty.status) &&
                    bounty.allocations.some((row) => row.closed && Number(row.awarded) < Number(row.planned)) && (
                      <Button size="sm" onClick={() => actionReason(bounty, "reopen")}>
                        更正后重新验收
                      </Button>
                    )}
                </div>
                {bounty.acceptances.length > 0 && (
                  <details className="mt-4 text-12">
                    <summary className="cursor-pointer text-secondary">验收记录</summary>
                    {bounty.acceptances.map((acceptance) => (
                      <p key={acceptance.id} className="mt-2 rounded bg-layer-1 p-2">
                        {acceptance.reviewer} · {acceptance.result} · {acceptance.approved_at ? "已记账" : "待复核"} ·{" "}
                        {acceptance.reason}
                      </p>
                    ))}
                  </details>
                )}
                {bounty.access_level !== "public" && <LabBountyMaterials store={store} bounty={bounty} />}
                {workflowIds.has(bounty.id) && <LabBountyWorkflow store={store} bounty={bounty} />}
              </article>
            );
          })}
      </div>
      {store.bounties.length === 0 && (
        <p className="rounded border border-dashed border-subtle p-10 text-center text-13 text-tertiary">
          暂无悬赏任务。
        </p>
      )}
      {reasonAction && (
        <LabDialog
          title="审批与复核意见"
          busy={store.busy}
          onClose={() => setReasonAction(undefined)}
          onSubmit={(form) =>
            store.execute(async () => {
              await store.request(`bounties/${reasonAction.bounty.id}/${reasonAction.action}/`, "POST", {
                ...reasonAction.extra,
                reason: form.get("reason"),
              });
              await store.loadMarket();
              setReasonAction(undefined);
            })
          }
        >
          <LabField label="处理意见">
            <textarea name="reason" className={labInputClass} required rows={4} />
          </LabField>
          {store.error && (
            <p role="alert" className="text-12 text-danger-primary">
              {store.error}
            </p>
          )}
        </LabDialog>
      )}
      {deleting && (
        <LabDialog
          title="删除悬赏"
          submitLabel="删除"
          busy={store.busy}
          error={store.error}
          onClose={() => setDeleting(undefined)}
          onSubmit={(form) =>
            store.execute(async () => {
              await store.request(`bounties/${deleting.id}/detail/`, "DELETE", {
                reason: form.get("reason"),
              });
              setDeleting(undefined);
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.delete("bounty_id");
                next.delete("bounty");
                return next;
              });
              await store.loadMarket();
              await store.loadPlanner();
              await mutate(
                (key) => Array.isArray(key) && key[0] === "lab-task-card-metadata" && key[1] === store.slug,
                undefined,
                { revalidate: true }
              );
            })
          }
        >
          <p className="text-14 font-medium">{deleting.title}</p>
          <LabField label="删除原因">
            <textarea name="reason" className={labInputClass} required rows={3} />
          </LabField>
        </LabDialog>
      )}
      {mode === "publish" && (
        <LabBountyPublish
          store={store}
          initialProjectId={projectFilter}
          onClose={close}
          onPublished={async () => {
            await store.loadMarket();
            await store.loadPlanner();
            await mutate(
              (key) => Array.isArray(key) && key[0] === "lab-task-card-metadata" && key[1] === store.slug,
              undefined,
              { revalidate: true }
            );
          }}
        />
      )}
      {mode === "public-summary" && chosen && (
        <LabDialog
          title="公开任务摘要设置"
          busy={store.busy}
          error={store.error}
          onClose={close}
          onSubmit={(form) =>
            finish(() =>
              store.request(`bounties/${chosen.id}/public-summary/`, "POST", {
                public_summary: form.get("public_summary"),
                public_deliverable: form.get("public_deliverable"),
                public_criteria: form.get("public_criteria"),
                enabled: form.get("enabled") === "on",
                reason: form.get("reason"),
              })
            )
          }
        >
          <LabField label="全实验室公开摘要">
            <textarea name="public_summary" className={labInputClass} required defaultValue={chosen.public_summary} />
          </LabField>
          <LabField label="全实验室公开交付要求">
            <textarea name="public_deliverable" className={labInputClass} required />
          </LabField>
          <LabField label="全实验室公开验收条件">
            <textarea name="public_criteria" className={labInputClass} required />
          </LabField>
          <label className="flex items-center gap-2 text-13">
            <input name="enabled" type="checkbox" defaultChecked />
            公开展示在全实验室大厅
          </label>
          <LabField label="修改依据">
            <textarea name="reason" className={labInputClass} required />
          </LabField>
        </LabDialog>
      )}
      {mode === "claim" && chosen && (
        <LabDialog
          title="申请团队分工"
          busy={store.busy}
          onClose={close}
          onSubmit={(data) =>
            finish(() =>
              store.request(`bounties/${chosen.id}/claim/`, "POST", {
                deliverable: data.get("deliverable"),
                planned: data.get("planned"),
              })
            )
          }
        >
          <LabField label="本人交付物">
            <textarea name="deliverable" className={labInputClass} required />
          </LabField>
          <LabField label="计划 VC">
            <input
              name="planned"
              type="number"
              min="0.01"
              max={chosen.budget}
              step="0.01"
              className={labInputClass}
              required
            />
          </LabField>
        </LabDialog>
      )}
      {mode === "submit" && chosen && (
        <LabDialog
          title="提交交付物或探索证据"
          busy={store.busy}
          onClose={close}
          onSubmit={(data) =>
            finish(() => store.request(`bounties/${chosen.id}/submit/`, "POST", { evidence: data.get("evidence") }))
          }
        >
          <LabField label="成果、附件链接、探索记录">
            <textarea name="evidence" className={labInputClass} rows={5} required />
          </LabField>
        </LabDialog>
      )}
      {mode === "accept" && chosen && (
        <LabDialog
          title="独立验收与累计贡献"
          busy={store.busy}
          onClose={close}
          onSubmit={(data) =>
            finish(() =>
              store.request(`bounties/${chosen.id}/accept/`, "POST", {
                request_key: acceptanceKey,
                result,
                reason: data.get("reason"),
                targets: ["rework", "reject"].includes(result)
                  ? {}
                  : Object.fromEntries(
                      chosen.allocations.filter((row) => row.approved).map((row) => [row.id, String(data.get(row.id))])
                    ),
              })
            )
          }
        >
          <LabField label="结果">
            <select className={labInputClass} value={result} onChange={(event) => setResult(event.target.value)}>
              <option value="pass">通过</option>
              <option value="partial">部分通过</option>
              <option value="negative">有效探索负结果（达到约定目标）</option>
              <option value="rework">返工</option>
              <option value="reject">不通过</option>
            </select>
          </LabField>
          <LabField label="验收意见">
            <textarea name="reason" className={labInputClass} required />
          </LabField>
          {!["rework", "reject"].includes(result) &&
            chosen.allocations
              .filter((row) => row.approved)
              .map((row) => (
                <LabField key={row.id} label={`${row.name} 累计通过 VC（已授予 ${row.awarded} / 计划 ${row.planned}）`}>
                  <input
                    name={row.id}
                    type="number"
                    min={row.awarded}
                    max={row.planned}
                    step="0.01"
                    className={labInputClass}
                    defaultValue={row.planned}
                    required
                  />
                </LabField>
              ))}
        </LabDialog>
      )}
    </div>
  );
});
