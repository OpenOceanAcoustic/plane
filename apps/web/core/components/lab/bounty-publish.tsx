/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router";
import type { LabBountyBudget, LabTask } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { LabDialog, LabField, labInputClass } from "@plane/ui";

export const LabBountyPublish = observer(function LabBountyPublish({
  store,
  initialProjectId,
  onClose,
  onPublished,
}: {
  store: LabStore;
  initialProjectId: string;
  onClose: () => void;
  onPublished: () => Promise<void>;
}) {
  const [budgets, setBudgets] = useState<LabBountyBudget[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [tasks, setTasks] = useState<LabTask[]>([]);
  const [issueId, setIssueId] = useState("");
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [cashCommitment, setCashCommitment] = useState("");
  const [personDays, setPersonDays] = useState("");
  const [safety, setSafety] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [budgetError, setBudgetError] = useState("");
  const [taskError, setTaskError] = useState("");

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const rows = await store.request<LabBountyBudget[]>("bounties/budgets/");
        if (!current) return;
        setBudgets(rows);
        setProjectId((previous) =>
          rows.some((row) => row.project_id === previous)
            ? previous
            : (rows.find((row) => row.configured)?.project_id ?? rows[0]?.project_id ?? "")
        );
      } catch (failure) {
        if (current) setBudgetError(failure instanceof Error ? failure.message : "项目预算读取失败");
      } finally {
        if (current) setLoadingBudgets(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [store]);

  useEffect(() => {
    if (!projectId) {
      setLoadingTasks(false);
      return;
    }
    let current = true;
    setLoadingTasks(true);
    setTaskError("");
    const search = new URLSearchParams({ project_id: projectId, publishable: "1", q: query });
    async function load() {
      try {
        const rows = await store.request<LabTask[]>(`tasks/?${search}`);
        if (current) setTasks(rows);
      } catch (failure) {
        if (current) setTaskError(failure instanceof Error ? failure.message : "工作项读取失败");
      } finally {
        if (current) setLoadingTasks(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [store, projectId, query]);

  const source = budgets.find((row) => row.project_id === projectId);
  const project = store.planner?.projects.find((row) => row.id === projectId);
  const quota = Number(budget);
  const major =
    quota >= 40 ||
    (source?.budget !== null && source?.budget !== undefined && quota > Number(source.budget) * 0.2) ||
    Number(cashCommitment) >= 5000 ||
    Number(personDays) > 10 ||
    safety;
  const financeUrl = `/${store.slug}/lab/finance${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`;

  return (
    <LabDialog
      title="发布悬赏"
      submitLabel="发布"
      busy={store.busy}
      error={store.error || budgetError || taskError}
      onClose={onClose}
      onSubmit={async (data) => {
        if (loadingBudgets || loadingTasks) throw new Error("悬赏资料尚未加载");
        if (!source?.configured) throw new Error("项目尚未配置 VC 预算");
        if (!tasks.some((task) => task.id === issueId && task.project_id === projectId))
          throw new Error("请选择当前项目的工作项");
        if (!Number.isFinite(quota) || quota <= 0 || quota > Number(source.available))
          throw new Error("VC 配额须大于零且不超过项目剩余预算");
        await store.execute(async () => {
          const deliverable = data.get("deliverable");
          const criteria = data.get("criteria");
          try {
            await store.request("bounties/", "POST", {
              project_id: projectId,
              issue_id: issueId,
              budget,
              public_summary: data.get("public_summary"),
              deliverable,
              public_deliverable: deliverable,
              criteria,
              public_criteria: criteria,
              reviewer_id: reviewerId,
              independent_reviewer_id: major ? data.get("independent_reviewer_id") : null,
              cash_commitment: cashCommitment || 0,
              person_days: personDays || 0,
              route_or_safety: safety,
            });
          } catch (failure) {
            try {
              setBudgets(await store.request<LabBountyBudget[]>("bounties/budgets/"));
            } catch (refreshFailure) {
              setBudgetError(refreshFailure instanceof Error ? refreshFailure.message : "项目预算刷新失败");
            }
            throw failure;
          }
          await onPublished();
          onClose();
        });
      }}
    >
      <LabField label="项目">
        <select
          name="project_id"
          className={labInputClass}
          value={projectId}
          required
          disabled={loadingBudgets}
          onChange={(event) => {
            setProjectId(event.target.value);
            setTasks([]);
            setIssueId("");
            setQuery("");
            setReviewerId("");
          }}
        >
          <option value="">请选择项目</option>
          {budgets.map((row) => (
            <option key={row.project_id} value={row.project_id}>
              {row.project}
            </option>
          ))}
        </select>
      </LabField>
      {loadingBudgets ? (
        <p role="status" className="text-13 text-secondary">
          正在加载项目预算
        </p>
      ) : source?.configured ? (
        <p className="text-13" aria-label="项目 VC 预算">
          VC预算 {source.budget} · 已占用 {source.reserved} · 剩余 {source.available}
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3 text-13">
          <span>{budgets.length ? "项目尚未配置 VC 预算" : "暂无可管理项目"}</span>
          <Link to={financeUrl} className="text-accent-primary">
            资金与奖励
          </Link>
        </div>
      )}
      <LabField label="工作项">
        <select
          name="issue_id"
          className={labInputClass}
          value={issueId}
          required
          disabled={loadingTasks || !projectId}
          onChange={(event) => setIssueId(event.target.value)}
        >
          <option value="">
            {loadingTasks ? "正在加载工作项" : tasks.length ? "请选择工作项" : "暂无可发布工作项"}
          </option>
          {tasks
            .filter((task) => task.project_id === projectId)
            .map((task) => (
              <option key={task.id} value={task.id}>
                {task.key} · {task.title}
              </option>
            ))}
        </select>
      </LabField>
      <input
        aria-label="搜索工作项"
        placeholder="搜索工作项"
        className={labInputClass}
        value={query}
        disabled={!projectId}
        onChange={(event) => {
          setQuery(event.target.value);
          setTasks([]);
          setIssueId("");
        }}
      />
      <LabField label="VC配额">
        <input
          name="budget"
          type="number"
          min="0.01"
          max={source?.available ?? undefined}
          step="0.01"
          className={labInputClass}
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
          required
        />
      </LabField>
      <LabField label="任务资料">
        <textarea name="public_summary" className={labInputClass} required rows={3} maxLength={4000} />
      </LabField>
      <LabField label="交付要求">
        <textarea name="deliverable" className={labInputClass} required rows={2} maxLength={4000} />
      </LabField>
      <LabField label="验收标准">
        <textarea name="criteria" className={labInputClass} required rows={2} maxLength={4000} />
      </LabField>
      <LabField label="验收人">
        <select
          name="reviewer_id"
          className={labInputClass}
          value={reviewerId}
          onChange={(event) => setReviewerId(event.target.value)}
          required
        >
          <option value="">请选择</option>
          {project?.members
            .filter((member) => !major || member.id !== store.planner?.user_id)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
        </select>
      </LabField>
      {major && (
        <LabField label="复核人">
          <select name="independent_reviewer_id" className={labInputClass} required>
            <option value="">请选择</option>
            {project?.members
              .filter((member) => member.id !== store.planner?.user_id && member.id !== reviewerId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </LabField>
      )}
      <details className="rounded border border-subtle p-3">
        <summary className="cursor-pointer text-13">更多设置</summary>
        <div className="mt-3 flex flex-col gap-3">
          <LabField label="现金承诺（元）">
            <input
              name="cash_commitment"
              type="number"
              min="0"
              step="0.01"
              className={labInputClass}
              value={cashCommitment}
              onChange={(event) => setCashCommitment(event.target.value)}
            />
          </LabField>
          <LabField label="预计人日">
            <input
              name="person_days"
              type="number"
              min="0"
              step="0.01"
              className={labInputClass}
              value={personDays}
              onChange={(event) => setPersonDays(event.target.value)}
            />
          </LabField>
          <label className="flex items-center gap-2 text-13">
            <input
              name="route_or_safety"
              type="checkbox"
              checked={safety}
              onChange={(event) => setSafety(event.target.checked)}
            />
            重大路线或安全事项
          </label>
        </div>
      </details>
    </LabDialog>
  );
});
