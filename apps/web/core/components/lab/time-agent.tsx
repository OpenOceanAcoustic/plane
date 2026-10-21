/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";

export type LabTimeAgentDraft = {
  project_id: string;
  project_name: string;
  date: string;
  hours: string;
  work: string;
  user_id: string;
  user_name: string;
  rate: string;
  confidence: number;
};

type LabTimeAgentResponse = {
  status: "draft" | "needs_input";
  question: string;
  draft: LabTimeAgentDraft | null;
  provider: string;
  model: string;
};

export function TimeAgentDialog({
  store,
  projectId,
  onClose,
  onDraft,
}: {
  store: LabStore;
  projectId: string;
  onClose: () => void;
  onDraft: (draft: LabTimeAgentDraft) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LabTimeAgentResponse>();
  async function parse(form: FormData) {
    const message = String(form.get("message") ?? "").trim();
    if (!message) throw new Error("请先描述要登记的工时");
    setBusy(true);
    try {
      const response = await store.request<LabTimeAgentResponse>("agent/time/", "POST", {
        project_id: projectId,
        message,
      });
      setResult(response);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LabDialog title="AI 登记工时" submitLabel="解析" busy={busy} onClose={onClose} onSubmit={parse}>
      <p className="text-13 text-secondary">
        用一句话描述，例如“今天我做了 3 小时，调试现金悬赏页面”。AI 只生成草稿，保存仍然走工时表单。
      </p>
      <LabField label="描述">
        <textarea
          name="message"
          className={labInputClass}
          rows={3}
          required
          placeholder="例如：昨天在 PEC3D 做了 5 小时，整理资金与奖励页面"
        />
      </LabField>
      {result?.status === "needs_input" && (
        <p role="status" className="rounded border border-subtle p-3 text-13">
          {result.question}
        </p>
      )}
      {result?.status === "draft" && result.draft && (
        <div className="space-y-3 rounded border border-subtle p-3">
          <p className="flex items-center gap-2 text-13 font-medium">
            <Sparkles size={14} /> 识别结果
          </p>
          <dl className="grid grid-cols-2 gap-2 text-12">
            <dt className="text-secondary">项目</dt>
            <dd>{result.draft.project_name}</dd>
            <dt className="text-secondary">日期</dt>
            <dd>{result.draft.date}</dd>
            <dt className="text-secondary">工时</dt>
            <dd>{result.draft.hours}</dd>
            <dt className="text-secondary">登记对象</dt>
            <dd>{result.draft.user_name}</dd>
            <dt className="text-secondary">内容</dt>
            <dd>{result.draft.work}</dd>
            <dt className="text-secondary">时薪</dt>
            <dd>{result.draft.rate || "未识别，提交前在工时表补充"}</dd>
          </dl>
          <Button type="button" size="sm" variant="primary" onClick={() => onDraft(result.draft!)}>
            填入工时表
          </Button>
        </div>
      )}
    </LabDialog>
  );
}
