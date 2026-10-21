/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { LabFinanceManagement, LabLaborTeam, LabManagementRecord } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabAmountInput, LabDialog, LabField, labDecimalText, labDecimalUnits, labInputClass } from "@plane/ui";
import { costCategories } from "./management-ui";
import { dateAfter, laborAmount, laborHours, localToday } from "./labor-calculation";
import { LaborTeamDialog } from "./labor-team-form";

type Line = { key: string; user_id: string; hours: string; rate: string };
const cents = (value: string) => labDecimalUnits(value) ?? 0n;
const product = (a: string, b: string) => (cents(a) * cents(b) + 50n) / 100n;

export function CostEntryDialog({
  store,
  path,
  data,
  row,
  reimbursement,
  prefill,
  onClose,
  onSaved,
}: {
  store: LabStore;
  path: string;
  data: LabFinanceManagement;
  row?: LabManagementRecord;
  reimbursement?: boolean;
  prefill?: Record<string, string>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => ({
    category: reimbursement ? "travel" : "labor",
    date: data.today ?? localToday(store.planner?.timezone),
    ...Object.fromEntries(Object.entries(row?.data ?? {}).filter(([, value]) => typeof value === "string")),
    ...prefill,
  }));
  const [lines, setLines] = useState<Line[]>(() => [
    {
      key: uuidv4(),
      user_id: prefill?.user_id ?? row?.data.user_id ?? data.user_id,
      hours: prefill?.hours ?? (row?.data.hours_expression || row?.data.hours || ""),
      rate: prefill?.rate ?? row?.data.rate ?? "",
    },
  ]);
  const [mode, setMode] = useState("single");
  const [teams, setTeams] = useState(data.teams ?? []);
  const [teamId, setTeamId] = useState("");
  const [teamEditing, setTeamEditing] = useState<{ team?: LabLaborTeam }>();
  const [end, setEnd] = useState<string | undefined>(row?.data.end_date);
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState(() => uuidv4());
  const [recordId] = useState(() => row?.id ?? uuidv4());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const changed = () => setRequestKey(uuidv4());
  const update = (field: string, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    changed();
  };
  const updateLine = (key: string, field: keyof Line, value: string) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
    changed();
  };
  const eligible = data.members.filter((member) => data.can_record || member.id === data.user_id);
  const selectMembers = (ids: string[]) => {
    setLines((current) =>
      ids.map(
        (id) =>
          current.find((line) => line.user_id === id) ?? {
            key: uuidv4(),
            user_id: id,
            hours: "",
            rate: "",
          }
      )
    );
    changed();
  };
  const selectTeam = (team: LabLaborTeam | undefined) => {
    setTeamId(team?.id ?? "");
    selectMembers(team?.data.member_ids.filter((id) => eligible.some((member) => member.id === id)) ?? []);
  };
  if (teamEditing)
    return (
      <LaborTeamDialog
        store={store}
        data={data}
        team={teamEditing.team}
        onClose={() => setTeamEditing(undefined)}
        onSaved={async (saved) => {
          setTeams((current) => [saved, ...current.filter((team) => team.id !== saved.id)]);
          selectTeam(saved);
          setMode("team");
          setTeamEditing(undefined);
          await onSaved();
        }}
      />
    );

  const labor = values.category === "labor";
  const maxDays = Math.max(1, ...lines.map((line) => laborHours(line.hours)?.days ?? 1));
  const endDate = end ?? dateAfter(values.date!, maxDays - 1);
  const duration =
    Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${values.date}T00:00:00Z`)) / 86400000) + 1;
  const laborTotal = lines.reduce((sum, line) => sum + laborAmount(line.hours, line.rate), 0n);
  const costTotal =
    cents(values.actual_amount ?? "0") +
    (values.category === "travel"
      ? product(values.days ?? "0", values.transport_rate ?? "0") + product(values.days ?? "0", values.meal_rate ?? "0")
      : 0n);
  const invalid =
    labor &&
    (!lines.length ||
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > 366 ||
      lines.some((line) => {
        const parsed = laborHours(line.hours);
        return (
          !line.user_id ||
          !parsed ||
          parsed.days > duration ||
          parsed.units > BigInt(Math.max(0, duration) * 2400) ||
          !/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(line.rate) ||
          cents(line.rate) <= 0n ||
          laborAmount(line.hours, line.rate) > 99999999999999n
        );
      }) ||
      new Set(lines.map((line) => line.user_id)).size !== lines.length ||
      (mode === "team" && !teamId));
  const periodError =
    labor &&
    lines.some((line) => {
      const parsed = laborHours(line.hours);
      return (
        parsed &&
        (parsed.days > duration || parsed.units > BigInt(Math.max(0, Number.isFinite(duration) ? duration : 0) * 2400))
      );
    })
      ? "工时超出所选期间，请调整结束日期或工时"
      : "";
  const hourError =
    labor && lines.some((line) => line.hours && !laborHours(line.hours)) ? "工时请填数字或天数×每日小时，例如5×8" : "";
  const field = (name: string, label: string, type = "text", fallback = "", required = true) => (
    <LabField label={required ? label : `${label}（选填）`}>
      {type === "amount" ? (
        <LabAmountInput
          name={name}
          aria-label={label}
          value={values[name] ?? fallback}
          onValueChange={(value) => update(name, value)}
          required={required}
          unit={name === "days" ? "天" : "元"}
        />
      ) : (
        <input
          aria-label={label}
          name={name}
          className={labInputClass}
          type={type}
          value={values[name] ?? fallback}
          required={required}
          maxLength={4000}
          onChange={(event) => update(name, event.target.value)}
        />
      )}
    </LabField>
  );
  return (
    <LabDialog
      title="登记工时与费用"
      wide={labor && mode !== "single"}
      busy={busy}
      error={failure}
      onClose={onClose}
      submitDisabled={invalid}
      onSubmit={async () => {
        setBusy(true);
        setFailure("");
        try {
          const common = { ...values, evidence: values.evidence ?? "", ...(labor ? { end_date: endDate } : {}) };
          await store.request(path, "POST", {
            kind: "cost",
            action: labor && mode !== "single" ? "save-batch" : "save",
            record_id: recordId,
            expected_version: row?.version ?? 0,
            request_key: requestKey,
            reason,
            data:
              labor && mode !== "single"
                ? {
                    ...common,
                    team_id: mode === "team" ? teamId : "",
                    lines: lines.map(({ key: _key, ...line }) => line),
                  }
                : {
                    ...common,
                    user_id: lines[0]?.user_id,
                    hours: labor ? (lines[0]?.hours ?? "0") : "0",
                    rate: labor ? (lines[0]?.rate ?? "0") : "0",
                  },
          });
          await onSaved();
          onClose();
        } catch (problem) {
          setFailure(problem instanceof Error ? problem.message : "保存失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <LabField label="费用类别">
            <select
              className={labInputClass}
              value={values.category}
              onChange={(event) => {
                update("category", event.target.value);
                setMode("single");
                setLines((current) =>
                  current.length ? [current[0]!] : [{ key: uuidv4(), user_id: data.user_id, hours: "", rate: "" }]
                );
              }}
            >
              {costCategories.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </LabField>
          {field("date", "发生日期", "date")}
          {labor && (
            <LabField label="结束日期">
              <input
                className={labInputClass}
                type="date"
                required
                value={endDate}
                min={values.date}
                onChange={(event) => {
                  setEnd(event.target.value);
                  changed();
                }}
              />
            </LabField>
          )}
          {labor && !row && data.can_record && (
            <LabField label="登记对象">
              <div role="group" aria-label="登记对象" className="flex flex-wrap gap-2">
                {[
                  { value: "single", label: "单人" },
                  { value: "multiple", label: "多人" },
                  { value: "team", label: "团队" },
                ].map((entry) => (
                  <Button
                    key={entry.value}
                    size="sm"
                    aria-pressed={mode === entry.value}
                    variant={mode === entry.value ? "primary" : "neutral-primary"}
                    onClick={() => {
                      setMode(entry.value);
                      changed();
                      if (entry.value === "single")
                        setLines((current) =>
                          current.length
                            ? [current[0]!]
                            : [{ key: uuidv4(), user_id: data.user_id, hours: "", rate: "" }]
                        );
                    }}
                  >
                    {entry.label}
                  </Button>
                ))}
              </div>
            </LabField>
          )}
        </div>
        {field("work", "工作内容／费用事项")}
        {labor ? (
          <>
            {mode === "team" && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <LabField label="团队">
                    <select
                      className={labInputClass}
                      value={teamId}
                      onChange={(event) => selectTeam(teams.find((team) => team.id === event.target.value))}
                    >
                      <option value="">请选择团队</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.data.name}
                        </option>
                      ))}
                    </select>
                  </LabField>
                </div>
                <Button size="sm" variant="neutral-primary" onClick={() => setTeamEditing({})}>
                  新建团队
                </Button>
                {teamId && (
                  <Button
                    size="sm"
                    variant="neutral-primary"
                    onClick={() => setTeamEditing({ team: teams.find((team) => team.id === teamId) })}
                  >
                    编辑团队
                  </Button>
                )}
              </div>
            )}
            <div className="overflow-x-auto rounded border border-subtle">
              <table className="w-full text-left text-13" aria-label="成员工时明细">
                <thead className="bg-layer-1">
                  <tr>
                    {[
                      "成员",
                      "工时（小时）",
                      "工时单价（元／小时）",
                      "合计（元）",
                      ...(mode === "multiple" ? ["操作"] : []),
                    ].map((label) => (
                      <th key={label} className="px-2 py-2 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const name = eligible.find((member) => member.id === line.user_id)?.name ?? `第${index + 1}行`;
                    const parsed = laborHours(line.hours);
                    return (
                      <tr key={line.key} className="border-t border-subtle">
                        <td className="min-w-28 p-2">
                          <select
                            aria-label={`成员 ${index + 1}`}
                            className={labInputClass}
                            required
                            value={line.user_id}
                            disabled={mode === "team"}
                            onChange={(event) => updateLine(line.key, "user_id", event.target.value)}
                          >
                            <option value="">请选择成员</option>
                            {eligible.map((member) => (
                              <option
                                key={member.id}
                                value={member.id}
                                disabled={lines.some((other) => other.key !== line.key && other.user_id === member.id)}
                              >
                                {member.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="min-w-28 p-2">
                          <input
                            aria-label={`工时 ${name}`}
                            className={labInputClass}
                            placeholder="5×8"
                            required
                            value={line.hours}
                            onChange={(event) => updateLine(line.key, "hours", event.target.value)}
                          />
                          {parsed && (
                            <span className="text-12 text-secondary">
                              {line.hours}＝{labDecimalText(parsed.units)} 小时
                            </span>
                          )}
                          {line.hours && !parsed && (
                            <span role="alert" className="text-12 text-danger-primary">
                              请输入数字或天数×每日小时
                            </span>
                          )}
                        </td>
                        <td className="min-w-36 p-2">
                          <LabAmountInput
                            aria-label={`工时单价 ${name}`}
                            value={line.rate}
                            required
                            unit="元"
                            onValueChange={(value) => updateLine(line.key, "rate", value)}
                          />
                        </td>
                        <td
                          className="bg-layer-2 p-2 text-right font-semibold whitespace-nowrap tabular-nums"
                          aria-label={`合计 ${name}`}
                        >
                          {labDecimalText(laborAmount(line.hours, line.rate))}
                        </td>
                        {mode === "multiple" && (
                          <td className="p-2">
                            <Button
                              size="sm"
                              variant="neutral-primary"
                              onClick={() => {
                                setLines((current) => current.filter((entry) => entry.key !== line.key));
                                changed();
                              }}
                            >
                              移除
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-subtle font-medium">
                  <tr>
                    <td className="p-2" colSpan={3}>
                      最终合计（元）
                    </td>
                    <td className="p-2 text-right font-semibold tabular-nums" aria-label="工时最终合计">
                      {labDecimalText(laborTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {mode === "multiple" && (
              <Button
                size="sm"
                variant="neutral-primary"
                disabled={lines.length >= eligible.length || lines.length >= 100}
                onClick={() => {
                  const member = eligible.find((entry) => !lines.some((line) => line.user_id === entry.id));
                  if (member)
                    setLines((current) => [...current, { key: uuidv4(), user_id: member.id, hours: "", rate: "" }]);
                  changed();
                }}
              >
                添加成员
              </Button>
            )}
          </>
        ) : (
          <>
            <LabField label="成员／报销人">
              <select
                className={labInputClass}
                value={lines[0]?.user_id ?? ""}
                required
                onChange={(event) => {
                  setLines([{ key: uuidv4(), user_id: event.target.value, hours: "", rate: "" }]);
                  changed();
                }}
              >
                {eligible.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </LabField>
            {field("actual_amount", "实际费用（元）", "amount", "0.00")}
            {values.category === "travel" && (
              <div className="grid grid-cols-3 gap-2">
                {field("days", "出差天数", "amount", "0.00")}
                {field("transport_rate", "每日交通补助（元）", "amount", "0.00")}
                {field("meal_rate", "每日餐费补助（元）", "amount", "0.00")}
              </div>
            )}
            <p aria-label="本次费用合计">合计：{labDecimalText(costTotal)} 元</p>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          {field("evidence", "费用凭证／依据", "text", "", false)}
          <LabField label="操作说明（选填）">
            <input
              aria-label="操作说明"
              className={labInputClass}
              maxLength={2000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                changed();
              }}
            />
          </LabField>
        </div>
        {(hourError || periodError) && (
          <p role="alert" className="text-13 text-danger-primary">
            {hourError || periodError}
          </p>
        )}
      </fieldset>
    </LabDialog>
  );
}
