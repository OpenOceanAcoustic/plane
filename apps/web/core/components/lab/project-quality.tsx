/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import type { LabManagementRecord, LabProjectQuality as QualityData } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, labInputClass } from "@plane/ui";
import { ManagementHistory, ManagementTable, managementCell as cell, downloadManagement } from "./management-ui";
import { ProjectQualityDialog } from "./project-quality-form";
import type { QualityAction } from "./project-quality-form";
import { qualityMatches, qualityStatus } from "./quality-status";
import type { QualityFilter } from "./quality-status";

const stages = [
  { id: "all", label: "全部资料" },
  { id: "plan", label: "项目计划" },
  { id: "development", label: "需求与开发" },
  { id: "testing", label: "测试资料" },
  { id: "delivery", label: "成果与结项" },
];
export function LabProjectQuality({ store, refreshKey }: { store: LabStore; refreshKey: number }) {
  const [params, setParams] = useSearchParams();
  const projects = store.planner?.projects ?? [];
  const projectId = params.get("project_id") ?? (projects.length === 1 ? projects[0]!.id : "");
  return (
    <div className="space-y-4">
      <label className="flex max-w-80 flex-col gap-1 text-13">
        当前项目
        <select
          aria-label="质量管理项目"
          value={projectId}
          className={labInputClass}
          onChange={(event) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (event.target.value) next.set("project_id", event.target.value);
              else next.set("project_id", "");
              return next;
            })
          }
        >
          <option value="">请选择项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {projectId ? (
        <QualityProject key={projectId} store={store} projectId={projectId} refreshKey={refreshKey} />
      ) : (
        <p className="text-13 text-secondary">请选择项目</p>
      )}
    </div>
  );
}

function QualityProject({ store, projectId, refreshKey }: { store: LabStore; projectId: string; refreshKey: number }) {
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
  const actions = (row: LabManagementRecord) => (
    <div className="flex flex-wrap gap-1">
      <details>
        <summary className="cursor-pointer rounded border border-subtle px-3 py-2 text-12">更多</summary>
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
            <>
              <Button
                size="sm"
                variant="neutral-primary"
                onClick={() => setChosen({ action: "save", kind: row.kind, row })}
              >
                {row.document_status === "unavailable" ? "重新关联" : "编辑"}
              </Button>
            </>
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
      {data.can_edit && row.state !== "submitted" && (row.state !== "approved" || !row.document_current) && (
        <Button
          size="sm"
          disabled={row.document_status === "unavailable"}
          onClick={() => setChosen({ action: "submit", kind: row.kind, row })}
        >
          {row.state === "approved" ? "重新提交评审" : "提交评审"}
        </Button>
      )}
      {data.can_edit && data.can_review && row.state === "submitted" && row.document_current && (
        <Button size="sm" onClick={() => setChosen({ action: "review", kind: row.kind, row })}>
          评审
        </Button>
      )}
    </div>
  );
  const status = qualityStatus;
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
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-14">
          已通过资料类别：{approved} / {data.catalog.length + 1}
        </p>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadManagement(store, `${path}?format=json`, "项目质量资料目录.json");
            } catch (problem) {
              setFailure(problem instanceof Error ? problem.message : "导出失败");
            } finally {
              setExporting(false);
            }
          }}
        >
          导出质量资料目录
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-danger-primary">
          {failure}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="资料状态筛选">
        {(
          [
            ["missing", "未登记", categories.filter((entry) => !rowsFor(entry.key).length).length],
            ["draft", "草稿／需修改", data.records.filter((row) => qualityMatches(row, "draft")).length],
            ["submitted", "待评审", data.records.filter((row) => qualityMatches(row, "submitted")).length],
            ["approved", "已通过", data.records.filter((row) => qualityMatches(row, "approved")).length],
            ["outdated", "待复审", data.records.filter((row) => qualityMatches(row, "outdated")).length],
          ] as [QualityFilter, string, number][]
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className="lab-management-count"
            onClick={() => {
              setFilter(value);
              setTab("all");
            }}
          >
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="项目质量阶段">
        {stages.map((stage) => (
          <Button
            size="sm"
            key={stage.id}
            aria-label={stage.label}
            aria-pressed={tab === stage.id}
            variant={tab === stage.id ? "accent-primary" : "neutral-primary"}
            onClick={() => {
              setTab(stage.id);
              setFilter("all");
            }}
          >
            {stage.label}
            <span className="ml-2 text-secondary">
              {
                categories.filter(
                  (entry) =>
                    (stage.id === "all" || entry.stage === stage.id) &&
                    rowsFor(entry.key).some((row) => qualityMatches(row, "approved"))
                ).length
              }
              /{categories.filter((entry) => stage.id === "all" || entry.stage === stage.id).length}
            </span>
          </Button>
        ))}
      </nav>
      <>
        {filter !== "all" && (
          <Button size="sm" variant="neutral-primary" onClick={() => setFilter("all")}>
            清除状态筛选
          </Button>
        )}
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
                        <td className={cell}>未登记</td>
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
                      <span className="block text-12 text-secondary">{category.label}</span>
                      {row.data.page_id && row.document_status !== "unavailable" ? (
                        <a
                          className="text-accent-primary underline"
                          href={`/${store.slug}/projects/${projectId}/pages/${row.data.page_id}`}
                        >
                          {row.data.title}
                        </a>
                      ) : (
                        row.data.title
                      )}
                    </td>
                    <td className={cell}>
                      <span
                        className="lab-management-status"
                        data-state={
                          !row.document_current && ["approved", "submitted"].includes(row.state)
                            ? "outdated"
                            : row.state
                        }
                      >
                        {status(row)}
                      </span>
                    </td>
                    <td className={`${cell} text-12`}>
                      <p>
                        资料记录 V{row.version} · {row.actor}
                      </p>
                      <p>
                        文档版本：
                        {row.document_version_at
                          ? new Date(row.document_version_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                          : "—"}
                      </p>
                      {row.data.reviewed_by && (
                        <p>
                          最近评审：{row.data.reviewed_by} ·{" "}
                          {row.data.reviewed_at
                            ? new Date(row.data.reviewed_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                            : "—"}
                        </p>
                      )}
                    </td>
                    <td className={cell}>{actions(row)}</td>
                  </tr>
                ));
            })}
        </ManagementTable>
      </>
      {tab === "plan" && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="mr-auto font-semibold">项目计划</h2>
            {!plan && data.can_edit && (
              <Button size="sm" onClick={() => setChosen({ action: "save", kind: "plan" })}>
                编制项目计划
              </Button>
            )}
          </div>
          {plan ? (
            <>
              <p className="text-13">
                {status(plan)} · V{plan.version}
              </p>
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
            <p className="text-13 text-secondary">尚未编制项目计划</p>
          )}
        </section>
      )}
    </section>
  );
}
