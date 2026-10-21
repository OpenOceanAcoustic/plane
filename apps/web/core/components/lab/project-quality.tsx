/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { CSSProperties } from "react";
import { CheckCircle2, ClipboardCheck, FilePlus2, FileWarning, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import useSWR from "swr";
import type { LabManagementRecord, LabProjectQuality as QualityData } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, labInputClass } from "@plane/ui";
import { ManagementHistory, ManagementTable, managementCell as cell, downloadManagement } from "./management-ui";
import { ProjectQualityDialog } from "./project-quality-form";
import type { QualityAction } from "./project-quality-form";
import { qualityMatches, qualityStatus } from "./quality-status";
import type { QualityFilter } from "./quality-status";
// oxlint-disable-next-line import/no-unassigned-import -- local workbench surfaces
import "./workbench.css";

const stages = [
  { id: "all", label: "全部资料" },
  { id: "plan", label: "项目计划" },
  { id: "development", label: "需求与开发" },
  { id: "testing", label: "测试资料" },
  { id: "delivery", label: "成果与结项" },
];

const statusState = (row: LabManagementRecord) =>
  !row.document_current && ["approved", "submitted"].includes(row.state) ? "outdated" : row.state;
const stamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";

export function LabProjectQuality({ store, refreshKey }: { store: LabStore; refreshKey: number }) {
  const [params, setParams] = useSearchParams();
  const projects = store.planner?.projects ?? [];
  const projectId = params.get("project_id") ?? (projects.length === 1 ? projects[0]!.id : "");
  const setProject = (id: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("project_id", id);
      else next.set("project_id", "");
      next.set("quality_stage", "all");
      return next;
    });
  if (!projectId)
    return (
      <section className="lab-workbench-panel" aria-label="选择质量项目">
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
          <div className="lab-empty-state">
            <p className="text-13 text-secondary">暂无可查看项目。</p>
            <Link className="text-13 text-accent-primary" to={`/${store.slug}/lab/participation`}>
              去参与管理
            </Link>
          </div>
        )}
      </section>
    );
  return (
    <QualityProject
      key={projectId}
      store={store}
      projectId={projectId}
      projects={projects}
      refreshKey={refreshKey}
      onProject={setProject}
    />
  );
}

function QualityProject({
  store,
  projectId,
  projects,
  refreshKey,
  onProject,
}: {
  store: LabStore;
  projectId: string;
  projects: { id: string; name: string; lead?: boolean | null }[];
  refreshKey: number;
  onProject: (id: string) => void;
}) {
  const path = `projects/${projectId}/quality/`;
  const { data, error, mutate } = useSWR(["lab-project-quality", store.slug, projectId, refreshKey], () =>
    store.request<QualityData>(path)
  );
  const [params, setParams] = useSearchParams();
  const tab = params.get("quality_stage") ?? "all";
  const setTab = (value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("quality_stage", value);
      return next;
    });
  const [filter, setFilter] = useState<QualityFilter>("all");
  const [chosen, setChosen] = useState<QualityAction>();
  const [history, setHistory] = useState<LabManagementRecord>();
  const [failure, setFailure] = useState("");
  const [exporting, setExporting] = useState(false);
  if (!data)
    return <p role={error ? "alert" : undefined}>{error instanceof Error ? error.message : "正在读取项目质量资料…"}</p>;
  const plan = data.records.find((record) => record.kind === "plan");
  const categories = [{ key: "plan", stage: "plan", label: "项目计划" }, ...data.catalog];
  const rowsFor = (key: string) =>
    data.records.filter((row) =>
      key === "plan" ? row.kind === "plan" : row.kind === "artifact" && row.data.category === key
    );
  const approved = new Set(
    data.records.filter((row) => row.state === "approved" && row.document_current).map((row) => row.data.category)
  ).size;
  const total = categories.length;
  const completion = total ? Math.round((approved / total) * 100) : 0;
  const missing = categories.filter((entry) => !rowsFor(entry.key).length);
  const pending = data.records.filter((row) => qualityMatches(row, "submitted"));
  const drafts = data.records.filter((row) => qualityMatches(row, "draft"));
  const outdated = data.records.filter((row) => qualityMatches(row, "outdated"));
  const createTarget = categories.find((entry) => entry.key !== "plan" && !rowsFor(entry.key).length) ?? categories[1];
  const openCreate = () => {
    if (!createTarget) {
      setChosen({ action: "save", kind: "plan" });
      return;
    }
    setChosen({ action: "save", kind: "artifact", category: createTarget.key });
  };
  const actions = (row: LabManagementRecord) => (
    <div className="flex flex-wrap items-center gap-1">
      {data.can_review && row.state === "submitted" && row.document_current && (
        <Button size="sm" onClick={() => setChosen({ action: "review", kind: row.kind, row })}>
          评审
        </Button>
      )}
      {data.can_edit && ["draft", "rejected"].includes(row.state) && (
        <Button size="sm" variant="neutral-primary" onClick={() => setChosen({ action: "save", kind: row.kind, row })}>
          继续编辑
        </Button>
      )}
      {data.can_edit && row.state !== "submitted" && (row.state !== "approved" || !row.document_current) && (
        <Button
          size="sm"
          disabled={row.document_status === "unavailable"}
          onClick={() => setChosen({ action: "submit", kind: row.kind, row })}
        >
          {row.state === "approved" ? "重新提交" : "提交评审"}
        </Button>
      )}
      <details>
        <summary className="cursor-pointer rounded border border-subtle px-2 py-1 text-12">更多</summary>
        <div className="flex flex-wrap gap-2 py-2">
          <Button size="sm" variant="neutral-primary" onClick={() => setHistory(row)}>
            历史
          </Button>
          {row.data.page_id && row.document_status !== "unavailable" && (
            <a
              className="rounded border border-subtle px-2 py-1 text-12 text-accent-primary"
              href={`/${store.slug}/projects/${projectId}/pages/${row.data.page_id}`}
            >
              打开文档
            </a>
          )}
          {data.can_edit && row.state !== "submitted" && (
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() => setChosen({ action: "save", kind: row.kind, row })}
            >
              {row.document_status === "unavailable" ? "重新关联" : "编辑"}
            </Button>
          )}
          {data.can_edit && row.state === "submitted" && (
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() => setChosen({ action: "withdraw", kind: row.kind, row })}
            >
              撤回
            </Button>
          )}
        </div>
      </details>
    </div>
  );
  const stats: { value: QualityFilter; label: string; count: number; tone: string; hint: string }[] = [
    { value: "missing", label: "未登记", count: missing.length, tone: "crimson", hint: "待补登" },
    { value: "draft", label: "草稿／需修改", count: drafts.length, tone: "orange", hint: "待完善" },
    { value: "submitted", label: "待评审", count: pending.length, tone: "purple", hint: "待处理" },
    {
      value: "approved",
      label: "已通过",
      count: data.records.filter((row) => qualityMatches(row, "approved")).length,
      tone: "emerald",
      hint: "已完成",
    },
    { value: "outdated", label: "待复审", count: outdated.length, tone: "indigo", hint: "文档已更新" },
  ];
  const stageProgress = stages
    .filter((stage) => stage.id !== "all" && stage.id !== "plan")
    .map((stage) => {
      const stageCategories = categories.filter((entry) => entry.stage === stage.id);
      const done = stageCategories.filter((entry) =>
        rowsFor(entry.key).some((row) => qualityMatches(row, "approved"))
      ).length;
      return Object.assign({}, stage, { done, total: stageCategories.length });
    });
  const todoRows = [
    ...pending.map((row) => ({ row, kind: "review" as const })),
    ...drafts.map((row) => ({ row, kind: "edit" as const })),
    ...outdated.map((row) => ({ row, kind: "resubmit" as const })),
  ].slice(0, 5);
  return (
    <section className="lab-management space-y-4" aria-label="项目过程与质量管理">
      {chosen && (
        <ProjectQualityDialog
          key={`${chosen.kind}-${chosen.action}-${chosen.row?.id ?? chosen.category ?? "new"}`}
          store={store}
          projectId={projectId}
          path={path}
          data={data}
          chosen={chosen}
          onClose={() => setChosen(undefined)}
          onSaved={async () => {
            await mutate();
          }}
        />
      )}
      {history && (
        <ManagementHistory store={store} path={path} record={history} onClose={() => setHistory(undefined)} />
      )}

      <div className="lab-command">
        <label className="lab-command-project">
          <span className="whitespace-nowrap">项目</span>
          <select
            aria-label="质量管理项目"
            value={projectId}
            className={labInputClass}
            onChange={(event) => onProject(event.target.value)}
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
            <CheckCircle2 size={12} />
            已通过 <strong>{approved}</strong> / {total}
          </span>
          <span className="lab-command-chip">
            <ShieldCheck size={12} />
            待评审 <strong>{pending.length}</strong>
          </span>
          {missing.length > 0 && (
            <span className="lab-command-chip">
              <FileWarning size={12} />
              待补 <strong>{missing.length}</strong>
            </span>
          )}
        </div>
        <div className="lab-command-actions">
          {data.can_edit && (
            <Button size="sm" variant="primary" onClick={openCreate}>
              <Plus size={14} className="mr-1" />
              登记资料
            </Button>
          )}
          {data.can_edit && !plan && (
            <Button size="sm" variant="neutral-primary" onClick={() => setChosen({ action: "save", kind: "plan" })}>
              编制项目计划
            </Button>
          )}
          {data.can_review && pending.length > 0 && (
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() => {
                setFilter("submitted");
                setTab("all");
              }}
            >
              处理待评审 {pending.length}
            </Button>
          )}
          <Button
            size="sm"
            variant="neutral-primary"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setFailure("");
              try {
                await downloadManagement(store, `${path}?format=json`, "项目质量资料目录.json");
              } catch (problem) {
                setFailure(problem instanceof Error ? problem.message : "导出失败");
              } finally {
                setExporting(false);
              }
            }}
          >
            导出目录
          </Button>
        </div>
      </div>

      <div className="lab-quality-overview">
        <section className="lab-quality-score" aria-label="资料完成度">
          <div className="lab-quality-ring" style={{ "--pct": completion } as CSSProperties}>
            <div className="lab-quality-ring-inner">
              <strong>{completion}%</strong>
              <span>已通过</span>
            </div>
          </div>
          <div className="lab-quality-score-copy">
            <strong>资料完成度</strong>
            <span>
              {approved} / {total} 类资料已通过
            </span>
            <span>
              {pending.length} 待评审 · {drafts.length} 需修改
            </span>
            <div className="lab-progress-track" aria-label={`资料完成度 ${completion}%`}>
              <div
                className="lab-progress-fill"
                data-tone={completion >= 80 ? "emerald" : completion >= 40 ? "orange" : "crimson"}
                style={{ "--progress": `${completion}%` } as CSSProperties}
              />
            </div>
          </div>
        </section>
        <div className="lab-quality-stats" aria-label="资料状态筛选">
          {stats.map((stat) => (
            <button
              type="button"
              key={stat.value}
              aria-pressed={filter === stat.value}
              data-tone={stat.tone}
              className="lab-quality-stat"
              onClick={() => {
                setFilter(stat.value);
                setTab("all");
              }}
            >
              <span className="lab-quality-stat-label">{stat.label}</span>
              <strong>{stat.count}</strong>
              <small>{stat.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="lab-workbench-grid">
        <section className="lab-workbench-panel" aria-label="待处理资料">
          <header className="lab-workbench-panel-head">
            <h2>待处理资料</h2>
            {filter !== "all" && (
              <Button size="sm" variant="neutral-primary" onClick={() => setFilter("all")}>
                清除筛选
              </Button>
            )}
          </header>
          {todoRows.length ? (
            <div className="lab-quality-todos">
              {todoRows.map(({ row, kind }) => (
                <div className="lab-quality-todo" key={row.id}>
                  <span className="lab-status-pill" data-state={statusState(row)}>
                    {qualityStatus(row)}
                  </span>
                  <div className="lab-quality-todo-main">
                    <p className="lab-quality-todo-title">{row.data.title || "未命名资料"}</p>
                    <p className="lab-quality-todo-meta">
                      {categories.find((entry) => entry.key === row.data.category)?.label ?? "项目计划"} ·{" "}
                      {row.data.user_name ?? row.actor}
                    </p>
                  </div>
                  {kind === "review" && data.can_review ? (
                    <Button size="sm" onClick={() => setChosen({ action: "review", kind: row.kind, row })}>
                      评审
                    </Button>
                  ) : kind === "edit" && data.can_edit ? (
                    <Button
                      size="sm"
                      variant="neutral-primary"
                      onClick={() => setChosen({ action: "save", kind: row.kind, row })}
                    >
                      继续编辑
                    </Button>
                  ) : kind === "resubmit" && data.can_edit ? (
                    <Button
                      size="sm"
                      variant="neutral-primary"
                      onClick={() => setChosen({ action: "submit", kind: row.kind, row })}
                    >
                      重新提交
                    </Button>
                  ) : (
                    <RefreshCw size={14} className="text-secondary" aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          ) : missing.length ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-13 text-secondary">
                还有 {missing.length} 类资料未登记：
                {missing
                  .slice(0, 3)
                  .map((entry) => entry.label)
                  .join("、")}
                {missing.length > 3 ? "…" : ""}
              </p>
              {data.can_edit && (
                <Button size="sm" variant="primary" onClick={openCreate}>
                  <FilePlus2 size={14} className="mr-1" />
                  补登资料
                </Button>
              )}
            </div>
          ) : (
            <p className="text-13 text-secondary">当前没有待处理资料。</p>
          )}
        </section>

        <section className="lab-workbench-panel" aria-label="项目计划与阶段">
          <header className="lab-workbench-panel-head">
            <h2>项目计划</h2>
            <Button size="sm" variant="neutral-primary" onClick={() => setTab("plan")}>
              查看计划
            </Button>
          </header>
          {plan ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="lab-status-pill" data-state={statusState(plan)}>
                  {qualityStatus(plan)}
                </span>
                <span className="text-12 text-secondary">V{plan.version}</span>
                <span className="text-12 text-secondary">{plan.data.assignments?.length ?? 0} 名成员有分工</span>
              </div>
              <p className="text-13 font-medium">{plan.data.title}</p>
              {data.can_edit && plan.state !== "submitted" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    onClick={() => setChosen({ action: "save", kind: "plan", row: plan })}
                  >
                    编辑计划
                  </Button>
                  <Button
                    size="sm"
                    disabled={plan.document_status === "unavailable"}
                    onClick={() => setChosen({ action: "submit", kind: "plan", row: plan })}
                  >
                    提交评审
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-13 text-secondary">尚未编制项目计划。</p>
              {data.can_edit && (
                <Button size="sm" variant="primary" onClick={() => setChosen({ action: "save", kind: "plan" })}>
                  编制项目计划
                </Button>
              )}
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-12 font-medium text-secondary">阶段归档</h3>
            {stageProgress.map((stage) => {
              const pct = stage.total ? Math.round((stage.done / stage.total) * 100) : 0;
              return (
                <button
                  type="button"
                  key={stage.id}
                  className="w-full text-left"
                  onClick={() => {
                    setTab(stage.id);
                    setFilter("all");
                  }}
                >
                  <div className="lab-budget-meta">
                    <span className="lab-budget-name">{stage.label}</span>
                    <span className="lab-budget-figures">
                      <strong>{stage.done}</strong> / {stage.total}
                    </span>
                  </div>
                  <div className="lab-progress-track mt-1">
                    <div
                      className="lab-progress-fill"
                      data-tone={pct >= 100 ? "emerald" : pct > 0 ? "indigo" : "crimson"}
                      style={{ "--progress": `${pct}%` } as CSSProperties}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <nav className="lab-quality-stage" aria-label="项目质量阶段">
        {stages.map((stage) => {
          const count = categories.filter((entry) => stage.id === "all" || entry.stage === stage.id).length;
          const done = categories.filter(
            (entry) =>
              (stage.id === "all" || entry.stage === stage.id) &&
              rowsFor(entry.key).some((row) => qualityMatches(row, "approved"))
          ).length;
          return (
            <button
              type="button"
              key={stage.id}
              aria-pressed={tab === stage.id}
              onClick={() => {
                setTab(stage.id);
                setFilter("all");
              }}
            >
              {stage.label}
              <span className="ml-2 text-secondary">
                {done}/{count}
              </span>
            </button>
          );
        })}
      </nav>

      {failure && (
        <p role="alert" className="text-danger-primary">
          {failure}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger-primary">
          {error instanceof Error ? error.message : "项目质量读取失败"}
        </p>
      )}

      {tab === "plan" ? (
        <section className="lab-workbench-panel" aria-label="项目计划详情">
          <header className="lab-workbench-panel-head">
            <h2>项目计划</h2>
            {!plan && data.can_edit && (
              <Button size="sm" onClick={() => setChosen({ action: "save", kind: "plan" })}>
                <ClipboardCheck size={14} className="mr-1" />
                编制项目计划
              </Button>
            )}
          </header>
          {plan ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="lab-status-pill" data-state={statusState(plan)}>
                  {qualityStatus(plan)}
                </span>
                <span className="text-13 text-secondary">
                  V{plan.version} · {plan.actor}
                </span>
              </div>
              <h3 className="text-14 font-medium">项目要求</h3>
              <p className="text-13 whitespace-pre-wrap">{plan.data.requirements}</p>
              <h3 className="text-14 font-medium">技术路径</h3>
              <p className="text-13 whitespace-pre-wrap">{plan.data.technical_route}</p>
              <ManagementTable headings={["项目成员", "职责与分工", "开始日期", "结束日期"]}>
                {plan.data.assignments?.map((row) => (
                  <tr key={row.id ?? `${row.user_id}-${row.start}-${row.work}`}>
                    {Object.entries({ member: row.user_name, work: row.work, start: row.start, end: row.end }).map(
                      ([key, value]) => (
                        <td className={cell} key={key}>
                          {value}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </ManagementTable>
              {actions(plan)}
            </>
          ) : (
            <p className="text-13 text-secondary">尚未编制项目计划。</p>
          )}
        </section>
      ) : (
        <ManagementTable headings={["资料类别／名称", "状态", "资料记录／文档版本", "操作"]}>
          {categories
            .filter((category) => tab === "all" || category.stage === tab)
            .flatMap((category) => {
              const rows = rowsFor(category.key);
              if (!rows.length)
                return filter !== "all" && filter !== "missing"
                  ? []
                  : [
                      <tr key={category.key}>
                        <td className={cell}>{category.label}</td>
                        <td className={cell}>
                          <span className="lab-status-pill">未登记</span>
                        </td>
                        <td className={cell}>—</td>
                        <td className={cell}>
                          {data.can_edit && (
                            <Button
                              size="sm"
                              variant="neutral-primary"
                              onClick={() =>
                                setChosen(
                                  category.key === "plan"
                                    ? { action: "save", kind: "plan" }
                                    : { action: "save", kind: "artifact", category: category.key }
                                )
                              }
                            >
                              {category.key === "plan" ? "编制项目计划" : "新增资料"}
                            </Button>
                          )}
                        </td>
                      </tr>,
                    ];
              return rows
                .filter((row) => qualityMatches(row, filter))
                .map((row) => (
                  <tr key={row.id}>
                    <td className={cell}>
                      <span className="lab-quality-category">{category.label}</span>
                      {row.data.page_id && row.document_status !== "unavailable" ? (
                        <a
                          className="lab-quality-title-link"
                          href={`/${store.slug}/projects/${projectId}/pages/${row.data.page_id}`}
                        >
                          {row.data.title}
                        </a>
                      ) : (
                        <span className="font-medium">{row.data.title}</span>
                      )}
                    </td>
                    <td className={cell}>
                      <span className="lab-status-pill" data-state={statusState(row)}>
                        {qualityStatus(row)}
                      </span>
                    </td>
                    <td className={`${cell} text-12`}>
                      <p>
                        资料 V{row.version} · {row.actor}
                      </p>
                      <p>更新：{stamp(row.document_version_at)}</p>
                      {row.data.reviewed_by && <p>评审：{row.data.reviewed_by}</p>}
                    </td>
                    <td className={cell}>{actions(row)}</td>
                  </tr>
                ));
            })}
        </ManagementTable>
      )}
    </section>
  );
}
