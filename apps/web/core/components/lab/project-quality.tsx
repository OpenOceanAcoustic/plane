/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import type { LabManagementRecord, LabProjectQuality as QualityData } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, labInputClass } from "@plane/ui";
import {
  ManagementHistory,
  ManagementTable,
  managementCell as cell,
  managementStates,
  downloadManagement,
} from "./management-ui";
import { ProjectQualityDialog } from "./project-quality-form";
import type { QualityAction } from "./project-quality-form";

const stages = [
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
        项目
        <select
          aria-label="质量管理项目"
          value={projectId}
          className={labInputClass}
          onChange={(event) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (event.target.value) next.set("project_id", event.target.value);
              else next.delete("project_id");
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
  const [tab, setTab] = useState("plan");
  const [chosen, setChosen] = useState<QualityAction>();
  const [history, setHistory] = useState<LabManagementRecord>();
  const [failure, setFailure] = useState("");
  const [exporting, setExporting] = useState(false);
  if (!data)
    return <p role={error ? "alert" : undefined}>{error instanceof Error ? error.message : "正在读取项目质量资料…"}</p>;
  const plan = data.records.find((record) => record.kind === "plan");
  const approved = new Set(
    data.records.filter((row) => row.state === "approved" && row.document_current).map((row) => row.data.category)
  ).size;
  const actions = (row: LabManagementRecord) => (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="neutral-primary" onClick={() => setHistory(row)}>
        历史
      </Button>
      {row.data.page_id && (
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
            编辑
          </Button>
          <Button size="sm" onClick={() => setChosen({ action: "submit", kind: row.kind, row })}>
            提交评审
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
      {data.can_edit && data.can_review && row.state === "submitted" && (
        <Button size="sm" onClick={() => setChosen({ action: "review", kind: row.kind, row })}>
          评审
        </Button>
      )}
    </div>
  );
  const status = (row: LabManagementRecord) =>
    row.state === "approved" && !row.document_current
      ? "文档已更新或不可用，待复审"
      : row.state === "submitted"
        ? "待评审"
        : managementStates[row.state];
  return (
    <section className="space-y-4" aria-label="项目过程与质量管理">
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
      <nav className="flex flex-wrap gap-2" aria-label="项目质量阶段">
        {stages.map((stage) => (
          <Button
            size="sm"
            key={stage.id}
            variant={tab === stage.id ? "accent-primary" : "neutral-primary"}
            onClick={() => setTab(stage.id)}
          >
            {stage.label}
          </Button>
        ))}
      </nav>
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
      {data.catalog
        .filter((entry) => entry.stage === tab)
        .map((category) => {
          const rows = data.records.filter((row) => row.kind === "artifact" && row.data.category === category.key);
          return (
            <section className="space-y-2 rounded-lg border border-subtle p-4" key={category.key}>
              <div className="flex items-center gap-2">
                <h2 className="mr-auto font-semibold">{category.label}</h2>
                {data.can_edit && (
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    onClick={() => setChosen({ action: "save", kind: "artifact", category: category.key })}
                  >
                    新增资料
                  </Button>
                )}
              </div>
              {rows.length ? (
                <ManagementTable headings={["资料名称", "状态", "版本／登记人", "操作"]}>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className={cell}>{row.data.title}</td>
                      <td className={cell}>
                        {status(row)}
                        {row.data.review_note && <p className="max-w-64 whitespace-pre-wrap">{row.data.review_note}</p>}
                      </td>
                      <td className={cell}>
                        V{row.version} · {row.actor}
                      </td>
                      <td className={cell}>{actions(row)}</td>
                    </tr>
                  ))}
                </ManagementTable>
              ) : (
                <p className="text-13 text-secondary">尚未登记资料</p>
              )}
            </section>
          );
        })}
    </section>
  );
}
