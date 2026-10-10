/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from "react";
import useSWR from "swr";
import { newRequestKey as uuidv4 } from "./business";
import type { LabFinanceOverview, LabFormulaParameter, LabRewardFormula } from "@plane/types";
import type { LabStore } from "./transport";
import { Button, LabDialog, LabField, labInputClass } from "./ui";

type FormulaTemplate = { name: string; task_expression: string; member_expression: string };
export function LabFormulaEditor({
  store,
  projectId,
  onClose,
  onSaved,
}: {
  store: LabStore;
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { data, error } = useSWR(["lab-formulas", store.scope, projectId], () =>
    store.request<{ templates: FormulaTemplate[]; versions: LabRewardFormula[] }>(`finance/formulas/${projectId}/`)
  );
  const [task, setTask] = useState("E * 0.2 * VC / B");
  const [member, setMember] = useState("E * (0.5 * b + 0.3 * r + 0.2 * VC / B)");
  const [parameters, setParameters] = useState<(LabFormulaParameter & { id: string })[]>([]);
  const [kind, setKind] = useState<"task" | "member">("task");
  const [result, setResult] = useState<string>();
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const latest = data?.versions[0];
    if (latest) {
      setTask(latest.task_expression);
      setMember(latest.member_expression);
      setParameters(
        latest.parameters.map((parameter) => ({
          name: parameter.name,
          scope: parameter.scope,
          unit: parameter.unit,
          source: parameter.source,
          default: parameter.default,
          id: uuidv4(),
        }))
      );
    }
  }, [data]);
  const payloadParameters = () =>
    parameters.map(({ id: _id, ...parameter }) => ({
      ...parameter,
      ...(parameter.default?.trim() ? { default: parameter.default.trim() } : { default: undefined }),
    }));
  const update = (id: string, changes: Partial<LabFormulaParameter>) => {
    setParameters((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    setResult(undefined);
  };
  return (
    <LabDialog
      title="项目预计奖励公式"
      busy={busy}
      onClose={onClose}
      error={localError || (error instanceof Error ? error.message : "")}
      submitLabel="保存新公式版本"
      onSubmit={async (form) => {
        setBusy(true);
        setLocalError("");
        try {
          await store.request(`finance/formulas/${projectId}/`, "POST", {
            task_expression: task,
            member_expression: member,
            parameters: payloadParameters(),
            reason: form.get("reason"),
          });
          await onSaved();
          onClose();
        } catch (failure) {
          setLocalError(failure instanceof Error ? failure.message : "公式保存失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      {data && (
        <LabField label="从模板开始">
          <select
            className={labInputClass}
            defaultValue=""
            onChange={(event) => {
              const template = data.templates.find((row) => row.name === event.target.value);
              if (template) {
                setTask(template.task_expression);
                setMember(template.member_expression);
                setResult(undefined);
              }
            }}
          >
            <option value="">保留当前项目公式</option>
            {data.templates.map((template) => (
              <option key={template.name} value={template.name}>
                {template.name}
              </option>
            ))}
          </select>
        </LabField>
      )}
      <LabField label="任务预计奖励公式">
        <textarea
          className={`${labInputClass} font-mono`}
          required
          value={task}
          onChange={(event) => {
            setTask(event.target.value);
            setResult(undefined);
          }}
        />
      </LabField>
      <LabField label="成员阶段预计奖励公式">
        <textarea
          className={`${labInputClass} font-mono`}
          required
          value={member}
          onChange={(event) => {
            setMember(event.target.value);
            setResult(undefined);
          }}
        />
      </LabField>
      <section>
        <h3 className="lab-section-heading">参数定义</h3>
        <dl className="lab-kv">
          {[
            ["E", "阶段奖励预算／到账奖励额度"],
            ["B", "冻结 VC 预算"],
            ["VC", "计划／有效贡献"],
            ["b", "冻结基础份额"],
            ["r", "冻结职责份额"],
          ].map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <fieldset className="lab-form-section">
        <legend className="lab-section-title">自定义数值参数</legend>
        {parameters.map((parameter) => (
          <div key={parameter.id} className="lab-form-fields">
            <LabField label="参数名（英文字母／数字／下划线）">
              <input
                className={labInputClass}
                required
                pattern="[A-Za-z_][A-Za-z_0-9]*"
                value={parameter.name}
                onChange={(event) => update(parameter.id, { name: event.target.value })}
              />
            </LabField>
            <LabField label="作用范围">
              <select
                className={labInputClass}
                value={parameter.scope}
                onChange={(event) =>
                  update(parameter.id, { scope: event.target.value as LabFormulaParameter["scope"] })
                }
              >
                <option value="task">任务</option>
                <option value="member">成员</option>
                <option value="stage">阶段</option>
              </select>
            </LabField>
            <LabField label="单位">
              <input
                className={labInputClass}
                required
                value={parameter.unit}
                onChange={(event) => update(parameter.id, { unit: event.target.value })}
              />
            </LabField>
            <LabField label="来源">
              <input
                className={labInputClass}
                required
                value={parameter.source}
                onChange={(event) => update(parameter.id, { source: event.target.value })}
              />
            </LabField>
            <LabField label="默认数值（可选）">
              <input
                type="number"
                step="any"
                className={labInputClass}
                value={parameter.default ?? ""}
                onChange={(event) => update(parameter.id, { default: event.target.value })}
              />
            </LabField>
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() => setParameters((rows) => rows.filter((row) => row.id !== parameter.id))}
            >
              删除参数
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="neutral-primary"
          onClick={() =>
            setParameters((rows) => [...rows, { id: uuidv4(), name: "", scope: "task", unit: "", source: "" }])
          }
        >
          添加数值参数
        </Button>
      </fieldset>
      <fieldset className="lab-form-section">
        <legend className="lab-section-title">样例试算</legend>
        <LabField label="试算对象">
          <select
            className={labInputClass}
            value={kind}
            onChange={(event) => setKind(event.target.value as "task" | "member")}
          >
            <option value="task">任务预计奖励</option>
            <option value="member">成员阶段预计奖励</option>
          </select>
        </LabField>
        <div className="lab-form-fields">
          {[
            { name: "E", label: "预算 E（元）", value: "70000" },
            { name: "B", label: "预算 B（VC）", value: "1000" },
            { name: "VC", label: "贡献 VC", value: "100" },
            ...(kind === "member"
              ? [
                  { name: "b", label: "基础份额 b", value: "0.1" },
                  { name: "r", label: "职责份额 r", value: "0.1" },
                ]
              : []),
            ...parameters
              .filter((parameter) => parameter.name && (parameter.scope === kind || parameter.scope === "stage"))
              .map((parameter) => ({
                name: parameter.name,
                label: `${parameter.name}（${parameter.unit}）`,
                value: parameter.default ?? "",
              })),
          ].map((input) => (
            <LabField key={input.name} label={input.label}>
              <input
                name={`sample-${input.name}`}
                type="number"
                step="any"
                defaultValue={input.value}
                className={labInputClass}
              />
            </LabField>
          ))}
        </div>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={busy}
          onClick={(event) => {
            const form = event.currentTarget.closest("form");
            if (!form) return;
            const inputs: Record<string, string> = {};
            new FormData(form).forEach((value, name) => {
              if (name.startsWith("sample-") && String(value).trim()) inputs[name.slice(7)] = String(value).trim();
            });
            setBusy(true);
            setLocalError("");
            void store
              .request<{ result: string }>(`finance/preview/${projectId}/`, "POST", {
                task_expression: task,
                member_expression: member,
                parameters: payloadParameters(),
                kind,
                inputs,
              })
              .then((preview) => setResult(preview.result))
              .catch((failure: unknown) => {
                setResult(undefined);
                setLocalError(failure instanceof Error ? failure.message : "试算失败");
              })
              .finally(() => setBusy(false));
          }}
        >
          计算样例预计金额
        </Button>
        {result !== undefined && (
          <div role="status" className="lab-hero">
            <span>参考预计奖励</span>
            <strong>¥{result}</strong>
          </div>
        )}
      </fieldset>
      <LabField label="新版本原因">
        <textarea name="reason" required rows={2} className={labInputClass} />
      </LabField>
      {data?.versions.length ? (
        <details className="text-12">
          <summary className="cursor-pointer">已有公式版本（{data.versions.length}）</summary>
          {data.versions.map((version) => (
            <div key={version.id} className="mt-2 rounded bg-layer-1 p-2">
              <p>
                v{version.version} · {version.actor} · {version.created_at.slice(0, 10)}
              </p>
              <p className="font-mono break-words">任务：{version.task_expression}</p>
              <p className="font-mono break-words">成员：{version.member_expression}</p>
              <p>{version.reason}</p>
            </div>
          ))}
        </details>
      ) : null}
    </LabDialog>
  );
}

export function LabForecastDialog({
  store,
  data,
  projectId,
  initialKind = "task",
  onClose,
  onSaved,
}: {
  store: LabStore;
  data: LabFinanceOverview;
  projectId: string;
  initialKind?: "task" | "member";
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [stageId, setStageId] = useState(data.stages.find((stage) => stage.project_id === projectId)?.stage_id ?? "");
  const [kind, setKind] = useState<"task" | "member">(initialKind);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const stage = data.stages.find((row) => row.stage_id === stageId);
  const formula = data.formulas.find((row) => row.project_id === stage?.project_id);
  return (
    <LabDialog
      title="保存奖励参考预测"
      busy={busy}
      onClose={onClose}
      error={error}
      onSubmit={async (form) => {
        const parameters: Record<string, string> = {};
        form.forEach((value, name) => {
          if (name.startsWith("parameter-") && String(value).trim()) parameters[name.slice(10)] = String(value).trim();
        });
        setBusy(true);
        setError("");
        try {
          await store.request("finance/forecast/", "POST", {
            stage_id: stageId,
            kind,
            basis: form.get("basis"),
            ...(kind === "task" ? { bounty_id: form.get("bounty_id") } : { user_id: form.get("user_id") }),
            parameters,
          });
          await onSaved();
          onClose();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "预测失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <LabField label="阶段">
        <select className={labInputClass} required value={stageId} onChange={(event) => setStageId(event.target.value)}>
          <option value="">请选择</option>
          {data.stages
            .filter((row) => !row.deleted && (!projectId || row.project_id === projectId))
            .map((row) => (
              <option key={row.stage_id} value={row.stage_id}>
                {row.name} · E ¥{row.E} · B {row.B}
              </option>
            ))}
        </select>
      </LabField>
      <LabField label="预测对象">
        <select
          className={labInputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as "task" | "member")}
        >
          <option value="task">任务预计奖励</option>
          <option value="member">成员阶段预计奖励</option>
        </select>
      </LabField>
      <LabField label="计算口径">
        <select name="basis" className={labInputClass}>
          <option value="budget">预算预测</option>
          <option value="received">到账测算</option>
        </select>
      </LabField>
      {kind === "task" ? (
        <LabField label="悬赏任务">
          <select name="bounty_id" className={labInputClass} required>
            <option value="">请选择</option>
            {store.bounties
              .filter((row) => row.stage_id === stageId)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title} · {row.budget} VC
                </option>
              ))}
          </select>
        </LabField>
      ) : (
        <LabField label="成员">
          <select name="user_id" className={labInputClass} required defaultValue={store.planner?.user_id}>
            <option value="">请选择</option>
            {data.members
              .filter((row) => stage?.can_manage || row.id === store.planner?.user_id)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </LabField>
      )}
      {formula ? (
        <dl className="lab-kv">
          <div>
            <dt>公式版本</dt>
            <dd>v{formula.version}</dd>
          </div>
          <div>
            <dt>表达式</dt>
            <dd>
              <code>{kind === "task" ? formula.task_expression : formula.member_expression}</code>
            </dd>
          </div>
        </dl>
      ) : (
        <p role="alert" className="text-12 text-danger-primary">
          请负责人先配置本项目公式。
        </p>
      )}
      {formula?.parameters
        .filter((parameter) => parameter.scope === kind || parameter.scope === "stage")
        .map((parameter) => (
          <LabField key={parameter.name} label={`${parameter.name}（${parameter.unit}；来源：${parameter.source}）`}>
            <input
              name={`parameter-${parameter.name}`}
              type="number"
              step="any"
              required={!parameter.default}
              defaultValue={parameter.default}
              className={labInputClass}
            />
          </LabField>
        ))}
    </LabDialog>
  );
}
