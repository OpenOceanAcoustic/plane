/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router";
import { v4 as uuidv4 } from "uuid";
import type { LabBountyBudget, LabTask } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import {
  LabAmountInput,
  LabDialog,
  LabField,
  labAmountError,
  labDecimalText as vcValue,
  labDecimalUnits,
  labInputClass,
} from "@plane/ui";

export const LabBountyPublish = observer(function LabBountyPublish({
  store,
  initialProjectId = "",
  fixedTask,
  onClose,
  onPublished,
}: {
  store: LabStore;
  initialProjectId?: string;
  fixedTask?: LabTask;
  onClose: () => void;
  onPublished: () => Promise<void>;
}) {
  const [budgets, setBudgets] = useState<LabBountyBudget[]>([]);
  const [selectedProjectId, setProjectId] = useState(initialProjectId);
  const [tasks, setTasks] = useState<LabTask[]>([]);
  const [selectedIssueId, setIssueId] = useState("");
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState("");
  const [projectPayment, setProjectPayment] = useState<string | null>(null);
  const [requestKey] = useState(() => uuidv4());
  const [reviewerId, setReviewerId] = useState("");
  const [major, setMajor] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [budgetError, setBudgetError] = useState("");
  const [taskError, setTaskError] = useState("");
  const projectId = fixedTask?.project_id ?? selectedProjectId;
  const issueId = fixedTask?.id ?? selectedIssueId;
  const fixedIssueId = fixedTask?.id;

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const rows = await store.request<LabBountyBudget[]>("bounties/budgets/");
        if (!current) return;
        setBudgets(rows);
        setProjectId((previous) =>
          rows.some((row) => row.project_id === previous && !row.deleted)
            ? previous
            : (rows.find((row) => row.configured && !row.deleted)?.project_id ??
              rows.find((row) => !row.deleted)?.project_id ??
              "")
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
      setTasks([]);
      setTaskError("");
      setLoadingTasks(false);
      return;
    }
    let current = true;
    setTasks([]);
    setLoadingTasks(true);
    setTaskError("");
    const search = new URLSearchParams({
      project_id: projectId,
      publishable: "1",
      ...(fixedIssueId ? { issue_id: fixedIssueId } : { q: query }),
    });
    async function load() {
      try {
        const rows = await store.request<LabTask[]>(`tasks/?${search}`);
        if (current) {
          setTasks(rows);
          if (fixedIssueId && !rows.some((row) => row.id === fixedIssueId && row.project_id === projectId))
            setTaskError("当前工作项不可发布悬赏");
        }
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
  }, [store, projectId, query, fixedIssueId]);

  const source = budgets.find((row) => row.project_id === projectId);
  const project = store.planner?.projects.find((row) => row.id === projectId);
  const task = tasks.find((row) => row.id === issueId && row.project_id === projectId);
  const quota = labDecimalUnits(budget);
  const personalFunding = source?.publication_source !== "project";
  const paymentLimit = personalFunding ? (source?.wallet?.available ?? source?.available) : source?.available;
  const projectAvailable = labDecimalUnits(source?.wallet?.project_available ?? "0") ?? 0n;
  const defaultProjectPayment = quota !== null ? (quota < projectAvailable ? quota : projectAvailable) : 0n;
  const projectUnits = projectPayment === null ? defaultProjectPayment : labDecimalUnits(projectPayment);
  const earnedUnits = quota !== null && projectUnits !== null ? quota - projectUnits : null;
  const earnedPayment = earnedUnits !== null && earnedUnits >= 0n ? vcValue(earnedUnits) : "";
  const paymentError =
    personalFunding && source?.wallet && budget.trim()
      ? projectUnits === null || earnedUnits === null || earnedUnits < 0n
        ? "项目额度支付不能超过悬赏配额"
        : labAmountError(vcValue(projectUnits), { limit: source.wallet.project_available, unit: "VC" }) ||
          labAmountError(earnedPayment, { limit: source.wallet.earned_available, unit: "VC" })
      : "";
  const quotaError = labAmountError(budget, { limit: paymentLimit, min: "0.01", unit: "VC" });
  const financeUrl = `/${store.slug}/lab/finance${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`;

  return (
    <LabDialog
      title="发布悬赏"
      submitLabel="发布"
      busy={store.busy}
      submitDisabled={
        quota === null ||
        quota <= 0n ||
        !!quotaError ||
        !!paymentError ||
        loadingBudgets ||
        loadingTasks ||
        !source?.configured ||
        source.deleted ||
        !task
      }
      error={
        store.error ||
        budgetError ||
        (source?.deleted
          ? source.project_deleted
            ? "资金项目已删除，请先恢复资金项目"
            : "阶段预算已删除，请先恢复阶段预算"
          : taskError)
      }
      onClose={onClose}
      onSubmit={async (data) => {
        if (loadingBudgets || loadingTasks) throw new Error("悬赏资料尚未加载");
        if (!source?.configured) throw new Error("项目尚未配置 VC 预算");
        if (source.deleted) throw new Error("资金预算已删除，请先恢复");
        if (!task) throw new Error("请选择当前项目的工作项");
        if (quota === null || quota <= 0n || quotaError || paymentError)
          throw new Error("VC 配额须大于零且不超过个人可用余额");
        await store.execute(async () => {
          const deliverable = data.get("deliverable");
          const criteria = data.get("criteria");
          try {
            await store.request("bounties/", "POST", {
              project_id: projectId,
              issue_id: issueId,
              budget,
              request_key: requestKey,
              ...(personalFunding && source.wallet && projectUnits !== null
                ? { project_vc: vcValue(projectUnits), earned_vc: earnedPayment }
                : {}),
              public_summary: data.get("public_summary"),
              deliverable,
              public_deliverable: deliverable,
              criteria,
              public_criteria: criteria,
              reviewer_id: reviewerId,
              independent_reviewer_id: major ? data.get("independent_reviewer_id") : null,
              major,
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
          disabled={!!fixedTask || loadingBudgets}
          onChange={(event) => {
            setProjectId(event.target.value);
            setProjectPayment(null);
            setTasks([]);
            setIssueId("");
            setQuery("");
            setReviewerId("");
          }}
        >
          {fixedTask ? (
            <option value={fixedTask.project_id}>{source?.project ?? fixedTask.project}</option>
          ) : (
            <>
              <option value="">请选择项目</option>
              {budgets
                .filter((row) => !row.deleted)
                .map((row) => (
                  <option key={row.project_id} value={row.project_id}>
                    {row.project}
                  </option>
                ))}
            </>
          )}
        </select>
      </LabField>
      {loadingBudgets ? (
        <p role="status" className="text-13 text-secondary">
          正在加载项目预算
        </p>
      ) : source?.configured && !source.deleted && source.wallet && personalFunding ? (
        <dl className="grid grid-cols-2 gap-1 text-13" aria-label="我的可用 VC">
          <dt>项目分配可用 VC</dt>
          <dd>{source.wallet.project_available}</dd>
          <dt>悬赏收入可用 VC</dt>
          <dd>{source.wallet.earned_available}</dd>
          <dt>合计可用 VC</dt>
          <dd>{source.wallet.available}</dd>
        </dl>
      ) : source?.configured && !source.deleted ? (
        <p className="text-13" aria-label="项目 VC 预算">
          VC预算 {source.budget} · 已占用 {source.reserved} · 剩余 {source.available}
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3 text-13">
          <span>
            {source?.deleted
              ? "资金预算已删除"
              : fixedTask && !source
                ? "当前项目不可发布悬赏"
                : budgets.length
                  ? "项目尚未配置 VC 预算"
                  : "暂无可发布项目"}
          </span>
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
          disabled={!!fixedTask || loadingTasks || !projectId}
          onChange={(event) => setIssueId(event.target.value)}
        >
          {fixedTask ? (
            <option value={fixedTask.id}>
              {task?.key ?? fixedTask.key} · {task?.title ?? fixedTask.title}
            </option>
          ) : (
            <>
              <option value="">
                {loadingTasks ? "正在加载工作项" : tasks.length ? "请选择工作项" : "暂无可发布工作项"}
              </option>
              {tasks
                .filter((row) => row.project_id === projectId)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.key} · {row.title}
                  </option>
                ))}
            </>
          )}
        </select>
      </LabField>
      {!fixedTask && (
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
      )}
      <LabField label="VC配额">
        <LabAmountInput
          aria-label="VC配额"
          name="budget"
          min="0.01"
          limit={paymentLimit}
          unit="VC"
          step="0.01"
          className={labInputClass}
          value={budget}
          onValueChange={setBudget}
          required
        />
      </LabField>
      {source?.wallet && personalFunding && (
        <>
          <LabField label="项目额度支付 VC">
            <LabAmountInput
              aria-label="项目额度支付 VC"
              min="0"
              limit={source.wallet.project_available}
              unit="VC"
              step="0.01"
              className={labInputClass}
              value={projectUnits !== null ? vcValue(projectUnits) : (projectPayment ?? "")}
              onValueChange={setProjectPayment}
              required
            />
          </LabField>
          <LabField label="悬赏收入支付 VC">
            <output aria-label="悬赏收入支付 VC">{earnedPayment || "0.00"}</output>
          </LabField>
          {paymentError && (
            <p role="alert" className="text-13 text-danger-primary">
              {paymentError}
            </p>
          )}
        </>
      )}
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
          {project?.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </LabField>
      <LabField label="重要级别">
        <select
          className={labInputClass}
          value={major ? "major" : "normal"}
          onChange={(event) => setMajor(event.target.value === "major")}
        >
          <option value="normal">普通</option>
          <option value="major">重大</option>
        </select>
      </LabField>
      {major && (
        <LabField label="复核人">
          <select name="independent_reviewer_id" className={labInputClass} required>
            <option value="">请选择</option>
            {project?.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </LabField>
      )}
    </LabDialog>
  );
});
