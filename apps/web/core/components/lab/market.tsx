/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@plane/ui";
import type { LabBounty, LabTask } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";
import { calendarInstant } from "./calendar-time";
import { LabLedger } from "./ledger";
import { LabBountyWorkflow } from "./workflow";

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
  const [mode, setMode] = useState<"stage" | "publish" | "claim" | "submit" | "accept" | "exception">();
  const [chosen, setChosen] = useState<LabBounty>();
  const [stageId, setStageId] = useState("");
  const [tasks, setTasks] = useState<LabTask[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [result, setResult] = useState("pass");
  const [acceptanceKey, setAcceptanceKey] = useState("");
  const [workflowIds, setWorkflowIds] = useState<Set<string>>(new Set());
  const [reasonAction, setReasonAction] = useState<{
    bounty: LabBounty;
    action: string;
    extra: Record<string, string>;
  }>();
  useEffect(() => {
    void store.execute(store.loadMarket);
  }, [store]);
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
    });
  }
  async function finish(action: () => Promise<void>) {
    await store.execute(async () => {
      await action();
      await store.loadMarket();
      close();
    });
  }
  const stage = store.stages.find((row) => row.id === stageId);
  const publishProject = planner.projects.find((project) => project.id === stage?.project_id);
  const people = Array.from(
    new Map(planner.projects.flatMap((project) => project.members).map((member) => [member.id, member])).values()
  );
  const actionReason = (bounty: LabBounty, action: string, extra: Record<string, string> = {}) => {
    setReasonAction({ bounty, action, extra });
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="neutral-primary" onClick={() => setMode("stage")}>
          冻结阶段预算 B
        </Button>
        <Button
          onClick={() => {
            setStageId(store.stages[0]?.id ?? "");
            setTasks([]);
            setMode("publish");
          }}
        >
          发布团队悬赏
        </Button>
        {planner.team_access && (
          <Button variant="neutral-primary" onClick={() => setMode("exception")}>
            批准 WIP 例外
          </Button>
        )}
        <select
          aria-label="按项目查看"
          className={`${labInputClass} ml-auto max-w-48`}
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          <option value="">全部有权限项目</option>
          {planner.projects.map((project) => (
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
              <a
                key={todo.id}
                href={`#bounty-${todo.id}`}
                className="rounded border border-subtle bg-surface-1 px-3 py-2 text-12"
              >
                {todo.action} · {todo.title}
                {todo.overdue ? " · 已逾期" : ""}
              </a>
            ))}
          </div>
        </section>
      )}
      <div className="flex flex-wrap gap-3">
        {store.stages
          .filter((row) => !projectFilter || row.project_id === projectFilter)
          .map((row) => (
            <div key={row.id} className="rounded-md border border-subtle px-4 py-3">
              <p className="text-13 font-medium">
                {row.project} · {row.name}
              </p>
              <p className="mt-1 text-12 text-secondary">
                冻结 B {row.budget} · 已占用 {row.reserved} · 可用{" "}
                {(Number(row.budget) - Number(row.reserved)).toFixed(2)}
              </p>
            </div>
          ))}
      </div>
      <div className="flex gap-4 text-13">
        <a
          className="text-accent-primary"
          href={`${store.apiBase}/api/workspaces/${store.slug}/lab/ledger/?format=csv${projectFilter ? `&project_id=${projectFilter}` : ""}`}
        >
          导出项目 VC CSV
        </a>
        <a
          className="text-accent-primary"
          target="_blank"
          rel="noreferrer"
          href={`${store.apiBase}/api/workspaces/${store.slug}/lab/ledger/${projectFilter ? `?project_id=${projectFilter}` : ""}`}
        >
          查看 VC JSON 与冲正记录
        </a>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {store.bounties
          .filter((row) => !projectFilter || row.project_id === projectFilter)
          .map((bounty) => {
            const mine = bounty.allocations.find((row) => row.user_id === planner.user_id);
            return (
              <article
                key={bounty.id}
                id={`bounty-${bounty.id}`}
                className={`scroll-mt-4 rounded-lg border border-subtle bg-surface-1 p-5 ${workflowIds.has(bounty.id) ? "xl:col-span-2" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="mb-1 text-12 text-tertiary">
                      {bounty.project}
                      {bounty.major ? " · 重大任务" : ""}
                    </p>
                    <h2 className="text-16 font-semibold">
                      {bounty.issue_id ? (
                        <a href={`/${store.slug}/projects/${bounty.project_id}/issues/${bounty.issue_id}`}>
                          {bounty.title}
                        </a>
                      ) : (
                        bounty.title
                      )}
                    </h2>
                  </div>
                  <span className="rounded bg-layer-1 px-2 py-1 text-12">{labels[bounty.status] ?? bounty.status}</span>
                </div>
                <p className="mt-3 text-13">
                  团队 T {bounty.budget} VC · 已授予 {bounty.awarded}
                </p>
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
                {bounty.overdue && (
                  <p className="text-orange-600 mt-2 text-12">验收已超过截止时间，请验收人处理；系统不会自动通过。</p>
                )}
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
                  {bounty.status === "open" && !mine && !bounty.is_reviewer && !bounty.is_independent_reviewer && (
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
                  {bounty.status === "open" && mine?.approved && !mine.confirmed && (
                    <Button size="sm" onClick={() => void act(bounty, "confirm")}>
                      确认交付约定
                    </Button>
                  )}
                  {bounty.status === "open" && bounty.is_lead && (
                    <Button size="sm" onClick={() => void act(bounty, "start")}>
                      团队开工
                    </Button>
                  )}
                  {mine?.approved && !mine.closed && ["active", "rework", "partial"].includes(bounty.status) && (
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
                        setAcceptanceKey(crypto.randomUUID());
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
                {workflowIds.has(bounty.id) && <LabBountyWorkflow store={store} bounty={bounty} />}
              </article>
            );
          })}
      </div>
      <LabLedger key={projectFilter} store={store} projectId={projectFilter} />
      {store.bounties.length === 0 && (
        <p className="rounded border border-dashed border-subtle p-10 text-center text-13 text-tertiary">
          负责人冻结阶段预算并发布悬赏后，成员可以认领分工。
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
      {mode === "stage" && (
        <LabDialog
          title="冻结阶段预算 B"
          busy={store.busy}
          onClose={close}
          onSubmit={(data) =>
            finish(() =>
              store.request("stages/", "POST", {
                project_id: data.get("project_id"),
                name: data.get("name"),
                budget: data.get("budget"),
              })
            )
          }
        >
          <LabField label="负责项目">
            <select name="project_id" className={labInputClass} required>
              <option value="">请选择</option>
              {planner.projects
                .filter((project) => project.lead)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
          </LabField>
          <LabField label="阶段（季度或里程碑）">
            <input name="name" className={labInputClass} required maxLength={120} />
          </LabField>
          <LabField label="预算 B（VC）">
            <input name="budget" type="number" min="0.01" step="0.01" className={labInputClass} required />
          </LabField>
          <label className="text-12">
            <input type="checkbox" required /> 我确认此阶段预算冻结，发布任务 T 将占用 B。
          </label>
        </LabDialog>
      )}
      {mode === "publish" && (
        <LabDialog
          title="发布团队任务卡"
          busy={store.busy}
          onClose={close}
          onSubmit={(data) =>
            finish(() =>
              store.request("bounties/", "POST", {
                stage_id: stageId,
                issue_id: data.get("issue_id"),
                budget: data.get("budget"),
                deliverable: data.get("deliverable"),
                criteria: data.get("criteria"),
                reviewer_id: data.get("reviewer_id"),
                independent_reviewer_id: data.get("independent_reviewer_id") || null,
                cash_commitment: data.get("cash_commitment") || 0,
                person_days: data.get("person_days") || 0,
                route_or_safety: data.get("route_or_safety") === "on",
              })
            )
          }
        >
          <LabField label="冻结阶段">
            <select
              className={labInputClass}
              value={stageId}
              onChange={(event) => {
                setStageId(event.target.value);
                setTasks([]);
              }}
              required
            >
              <option value="">请选择</option>
              {store.stages
                .filter((row) => planner.projects.find((project) => project.id === row.project_id)?.lead)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.project} · {row.name}
                  </option>
                ))}
            </select>
          </LabField>
          <LabField label="搜索已有团队任务">
            <input
              className={labInputClass}
              onChange={(event) =>
                void store.execute(async () => {
                  setTasks(await store.request<LabTask[]>(`tasks/?q=${encodeURIComponent(event.target.value)}`));
                })
              }
            />
          </LabField>
          <LabField label="原生任务">
            <select name="issue_id" className={labInputClass} required>
              <option value="">请选择同项目顶层任务</option>
              {tasks
                .filter((task) => task.project_id === stage?.project_id)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.key} · {task.title}
                  </option>
                ))}
            </select>
          </LabField>
          <LabField label="团队预算 T（VC）">
            <input name="budget" type="number" min="0.01" step="0.01" className={labInputClass} required />
          </LabField>
          <LabField label="交付物">
            <textarea name="deliverable" className={labInputClass} required />
          </LabField>
          <LabField label="验收条件">
            <textarea name="criteria" className={labInputClass} required />
          </LabField>
          <LabField label="指定独立验收人">
            <select name="reviewer_id" className={labInputClass} required>
              <option value="">请选择</option>
              {publishProject?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="重大任务复核人（达到重大门槛时必填）">
            <select name="independent_reviewer_id" className={labInputClass}>
              <option value="">请选择</option>
              {publishProject?.members
                .filter((member) => member.id !== planner.user_id)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </LabField>
          <div className="grid grid-cols-2 gap-3">
            <LabField label="新现金承诺（元，仅判定重大）">
              <input name="cash_commitment" type="number" min="0" step="0.01" className={labInputClass} />
            </LabField>
            <LabField label="预计人日">
              <input name="person_days" type="number" min="0" step="0.01" className={labInputClass} />
            </LabField>
          </div>
          <label className="text-13">
            <input type="checkbox" name="route_or_safety" /> 涉及重大路线或安全事项
          </label>
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
          <p className="text-12 text-tertiary">只记新增差额。重大任务还需独立复核。</p>
        </LabDialog>
      )}
      {mode === "exception" && (
        <LabDialog
          title="批准有期限的 WIP 例外"
          busy={store.busy}
          onClose={close}
          onSubmit={(data) =>
            finish(() =>
              store.request("wip-exceptions/", "POST", {
                user_id: data.get("user_id"),
                reason: data.get("reason"),
                expires_at: calendarInstant(String(data.get("expires_at"))),
                active_limit: data.get("active_limit"),
                major_limit: data.get("major_limit"),
              })
            )
          }
        >
          <LabField label="成员">
            <select name="user_id" className={labInputClass} required>
              <option value="">请选择他人</option>
              {people
                .filter((member) => member.id !== planner.user_id)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </LabField>
          <LabField label="批准原因">
            <textarea name="reason" className={labInputClass} required />
          </LabField>
          <LabField label="截止时间（上海）">
            <input name="expires_at" type="datetime-local" step={900} className={labInputClass} required />
          </LabField>
          <LabField label="进行中上限">
            <input
              name="active_limit"
              type="number"
              min={2}
              max={10}
              defaultValue={3}
              className={labInputClass}
              required
            />
          </LabField>
          <LabField label="重大上限">
            <input
              name="major_limit"
              type="number"
              min={1}
              max={5}
              defaultValue={1}
              className={labInputClass}
              required
            />
          </LabField>
        </LabDialog>
      )}
    </div>
  );
});
