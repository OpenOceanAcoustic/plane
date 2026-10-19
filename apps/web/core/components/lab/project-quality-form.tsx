/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import useSWR from "swr";
import { v4 as uuidv4 } from "uuid";
import type { LabAssignment, LabManagementRecord, LabProjectQuality } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";
import type { LabDocumentList } from "./document-types";
import { LabDocumentUploadButton } from "./document-file-upload";

export type QualityAction = {
  action: string;
  kind: LabManagementRecord["kind"];
  row?: LabManagementRecord;
  category?: string;
};
export function ProjectQualityDialog({
  store,
  projectId,
  path,
  data,
  chosen,
  onClose,
  onSaved,
}: {
  store: LabStore;
  projectId: string;
  path: string;
  data: LabProjectQuality;
  chosen: QualityAction;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { action, kind, row } = chosen;
  const category = chosen.category ?? row?.data.category;
  const specification = data.catalog.find((entry) => entry.key === category);
  const [title, setTitle] = useState(row?.data.title ?? (kind === "plan" ? "项目计划" : (specification?.label ?? "")));
  const [content, setContent] = useState(
    row?.data.content ?? specification?.sections.map((section) => `${section}\n`).join("\n") ?? ""
  );
  const [mode, setMode] = useState(row?.data.page_id && !row.data.content ? "link" : "write");
  const [pageId, setPageId] = useState(row?.data.page_id ?? "");
  const [requirements, setRequirements] = useState(row?.data.requirements ?? "");
  const [route, setRoute] = useState(row?.data.technical_route ?? "");
  const [assignments, setAssignments] = useState<(LabAssignment & { rowId: string })[]>(() =>
    (row?.data.assignments ?? [{ user_id: "", work: "", start: "", end: "" }]).map((entry) =>
      Object.assign({ rowId: uuidv4() }, entry)
    )
  );
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState("approved");
  const [requestKey, setRequestKey] = useState(() => uuidv4());
  const [recordId] = useState(() => row?.id ?? (kind === "plan" ? data.plan_id : uuidv4()));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const changed = () => {
    setDirty(true);
    setRequestKey(uuidv4());
  };
  const { data: documents, mutate: refreshDocuments } = useSWR(
    mode !== "write" && action === "save" ? ["quality-project-documents", store.slug, projectId] : null,
    () => store.request<LabDocumentList>(`projects/${projectId}/documents/`)
  );
  const assign = (rowId: string, field: keyof LabAssignment, value: string) => {
    setAssignments((current) => current.map((entry) => (entry.rowId === rowId ? { ...entry, [field]: value } : entry)));
    changed();
  };
  const name =
    action === "save"
      ? kind === "plan"
        ? "编制项目计划"
        : "登记质量资料"
      : action === "review"
        ? "资料评审"
        : action === "submit"
          ? "提交资料评审"
          : "撤回资料评审";
  return (
    <LabDialog
      title={name}
      wide={action === "save"}
      submitLabel={
        action === "save"
          ? "保存草稿"
          : action === "review"
            ? result === "approved"
              ? "确认通过"
              : "确认退回"
            : action === "submit"
              ? "提交评审"
              : "确认撤回"
      }
      busy={busy}
      error={error}
      onClose={() => {
        if (!dirty || window.confirm("放弃未保存的修改？")) onClose();
      }}
      onSubmit={async () => {
        setBusy(true);
        setError("");
        try {
          await store.request(path, "POST", {
            kind,
            action,
            record_id: recordId,
            expected_version: row?.version ?? 0,
            request_key: requestKey,
            reason,
            data:
              action === "review"
                ? { result, note }
                : {
                    title,
                    category,
                    content: mode === "write" ? content : "",
                    page_id: mode !== "write" ? pageId : "",
                    requirements,
                    technical_route: route,
                    assignments: assignments.map(({ rowId: _id, ...entry }) => entry),
                  },
          });
          await onSaved();
          onClose();
        } catch (problem) {
          setError(problem instanceof Error ? problem.message : "保存失败");
          await onSaved().catch(() => undefined);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        {action !== "save" && row && (
          <dl className="space-y-1 rounded-lg border border-subtle bg-layer-2 p-3 text-13">
            <div>资料：{row.data.title}</div>
            <div>资料记录：V{row.version}</div>
            <div>
              文档版本：
              {row.document_version_at
                ? new Date(row.document_version_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                : "—"}
            </div>
            <div>提交人：{row.data.submitted_by ?? row.actor}</div>
            <div>
              提交时间：
              {row.data.submitted_at
                ? new Date(row.data.submitted_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                : "—"}
            </div>
            {row.data.page_id && row.document_status !== "unavailable" && (
              <a
                className="inline-block text-accent-primary underline"
                target="_blank"
                rel="noreferrer"
                href={`/${store.slug}/projects/${projectId}/pages/${row.data.page_id}`}
              >
                查看当前文档
              </a>
            )}
          </dl>
        )}
        {action === "save" && (
          <>
            <LabField label="资料名称">
              <input
                className={labInputClass}
                value={title}
                maxLength={255}
                required
                onChange={(event) => {
                  setTitle(event.target.value);
                  changed();
                }}
              />
            </LabField>
            {kind === "plan" ? (
              <>
                <LabField label="项目要求">
                  <textarea
                    className={labInputClass}
                    value={requirements}
                    rows={4}
                    maxLength={10000}
                    required
                    onChange={(event) => {
                      setRequirements(event.target.value);
                      changed();
                    }}
                  />
                </LabField>
                <LabField label="技术路径">
                  <textarea
                    className={labInputClass}
                    value={route}
                    rows={4}
                    maxLength={10000}
                    required
                    onChange={(event) => {
                      setRoute(event.target.value);
                      changed();
                    }}
                  />
                </LabField>
                <h3 className="text-14 font-medium">成员分工与排期</h3>
                {assignments.map((entry, index) => (
                  <div key={entry.rowId} className="grid gap-2 rounded border border-subtle p-3 sm:grid-cols-4">
                    <LabField label={`第${index + 1}项项目成员`}>
                      <select
                        className={labInputClass}
                        value={entry.user_id}
                        required
                        onChange={(event) => assign(entry.rowId, "user_id", event.target.value)}
                      >
                        <option value="">请选择成员</option>
                        {data.members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </LabField>
                    <LabField label={`第${index + 1}项职责与分工`}>
                      <textarea
                        className={labInputClass}
                        value={entry.work}
                        required
                        maxLength={2000}
                        onChange={(event) => assign(entry.rowId, "work", event.target.value)}
                      />
                    </LabField>
                    <LabField label={`第${index + 1}项开始日期`}>
                      <input
                        type="date"
                        className={labInputClass}
                        value={entry.start}
                        required
                        onChange={(event) => assign(entry.rowId, "start", event.target.value)}
                      />
                    </LabField>
                    <LabField label={`第${index + 1}项结束日期`}>
                      <input
                        type="date"
                        className={labInputClass}
                        value={entry.end}
                        required
                        min={entry.start || undefined}
                        onChange={(event) => assign(entry.rowId, "end", event.target.value)}
                      />
                    </LabField>
                    <Button
                      size="sm"
                      variant="neutral-primary"
                      disabled={assignments.length === 1}
                      onClick={() => {
                        setAssignments(assignments.filter((line) => line.rowId !== entry.rowId));
                        changed();
                      }}
                    >
                      删除分工
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="neutral-primary"
                  disabled={assignments.length >= 100}
                  onClick={() => {
                    setAssignments([...assignments, { rowId: uuidv4(), user_id: "", work: "", start: "", end: "" }]);
                    changed();
                  }}
                >
                  添加成员分工
                </Button>
              </>
            ) : (
              <>
                <LabField label="资料来源">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="资料来源">
                    {[
                      { value: "write", label: "在线编写" },
                      { value: "link", label: "关联项目文档" },
                      { value: "upload", label: "上传文件" },
                    ].map((entry) => (
                      <Button
                        key={entry.value}
                        size="sm"
                        aria-pressed={mode === entry.value}
                        variant={mode === entry.value ? "primary" : "neutral-primary"}
                        onClick={() => {
                          setMode(entry.value);
                          changed();
                        }}
                      >
                        {entry.label}
                      </Button>
                    ))}
                  </div>
                </LabField>
                {mode === "write" ? (
                  <LabField label="资料内容">
                    <textarea
                      className={labInputClass}
                      rows={12}
                      value={content}
                      required
                      maxLength={60000}
                      onChange={(event) => {
                        setContent(event.target.value);
                        changed();
                      }}
                    />
                  </LabField>
                ) : (
                  <>
                    <LabField label="关联文档">
                      <select
                        className={labInputClass}
                        required
                        value={pageId}
                        onChange={(event) => {
                          setPageId(event.target.value);
                          changed();
                        }}
                      >
                        <option value="">请选择项目共享文档</option>
                        {row?.data.page_id && !documents?.documents.some((entry) => entry.id === row.data.page_id) && (
                          <option value={row.data.page_id}>{row.data.page_name || "原关联文档"}</option>
                        )}
                        {documents?.documents
                          .filter((entry) => entry.access === 0 && !entry.archived_at)
                          .map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ))}
                      </select>
                    </LabField>
                    <LabDocumentUploadButton
                      workspaceSlug={store.slug}
                      projectId={projectId}
                      defaultAccess={0}
                      onUploaded={async (document) => {
                        setPageId(document.id);
                        setTitle(document.name);
                        changed();
                        await refreshDocuments();
                      }}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
        {action === "review" && (
          <>
            <LabField label="评审结果">
              <select
                className={labInputClass}
                value={result}
                onChange={(event) => {
                  setResult(event.target.value);
                  changed();
                }}
              >
                <option value="approved">通过</option>
                <option value="rejected">退回修改</option>
              </select>
            </LabField>
            <LabField label="评审意见">
              <textarea
                className={labInputClass}
                value={note}
                maxLength={4000}
                required
                onChange={(event) => {
                  setNote(event.target.value);
                  changed();
                }}
              />
            </LabField>
          </>
        )}
        <LabField label="操作说明">
          <textarea
            className={labInputClass}
            value={reason}
            required
            maxLength={2000}
            onChange={(event) => {
              setReason(event.target.value);
              changed();
            }}
          />
        </LabField>
      </fieldset>
    </LabDialog>
  );
}
