/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { v4 as uuidv4 } from "uuid";
import type { LabBounty, LabBountyQuote, LabBountyQuotes, LabQuoteAttachment } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabAmountInput, LabDialog, LabField, labAmountError, labDecimalUnits, labInputClass } from "@plane/ui";

const statuses: Record<LabBountyQuote["status"], string> = {
  pending: "待负责人审批",
  pending_review: "待加价复核",
  approved: "已承接",
  rejected: "已驳回",
  closed: "已结束",
};
type Props = { store: LabStore; bounty: LabBounty; onChanged?: () => Promise<unknown> };
type Decision = {
  quote: LabBountyQuote;
  action: "approve" | "reject" | "review";
  decision?: "approve" | "reject";
  key: string;
};

function QuoteApplication({
  store,
  bounty,
  data,
  kind,
  onClose,
  onChanged,
  refresh,
}: Props & {
  data: LabBountyQuotes;
  kind: "original" | "negotiated";
  onClose: () => void;
  refresh: () => Promise<LabBountyQuotes | undefined>;
}) {
  const [vc, setVc] = useState(kind === "original" ? data.available : "");
  const [deliverable, setDeliverable] = useState("");
  const [basis, setBasis] = useState("");
  const [files, setFiles] = useState<{ id: string; file: File }[]>([]);
  const [uploaded, setUploaded] = useState<LabQuoteAttachment[]>([]);
  const [key] = useState(() => uuidv4());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amountError = labAmountError(vc, { min: "0.01", unit: "VC" });
  const fileError =
    files.length > 20
      ? "最多 20 个附件"
      : files.some(({ file }) => !file.size || file.size > data.file_size_limit)
        ? `附件须非空且不超过 ${(data.file_size_limit / 1024 / 1024).toFixed(1)} MB`
        : "";
  return (
    <LabDialog
      title={kind === "original" ? "按原价申请" : "议价申请"}
      busy={busy}
      onClose={onClose}
      submitLabel="提交申请"
      error={fileError || error}
      submitDisabled={
        !!amountError || !!fileError || !deliverable.trim() || (kind === "negotiated" && !basis.trim() && !files.length)
      }
      onSubmit={async () => {
        setBusy(true);
        setError("");
        try {
          const attachments = [...uploaded];
          for (const { file } of files.slice(attachments.length)) {
            const body = new FormData();
            body.append("file", file);
            // oxlint-disable-next-line no-await-in-loop -- Keep successful uploads when a later upload needs a retry.
            attachments.push(await store.upload<LabQuoteAttachment>(`bounties/${bounty.id}/quote-attachments/`, body));
            setUploaded([...attachments]);
          }
          await store.request(`bounties/${bounty.id}/quotes/`, "POST", {
            kind,
            vc,
            deliverable,
            basis,
            attachment_ids: attachments.map((row) => row.id),
            request_key: key,
          });
          onClose();
          await onChanged?.();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "申请失败，请重试");
          try {
            const latest = await refresh();
            if (kind === "original" && latest) setVc(latest.available);
          } catch {
            /* Keep the application and its error available for retry. */
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <LabField label="本人交付内容">
        <textarea
          className={labInputClass}
          required
          maxLength={4000}
          value={deliverable}
          onChange={(event) => setDeliverable(event.target.value)}
        />
      </LabField>
      <LabField label={kind === "original" ? "原价（VC）" : "报价（VC）"}>
        <LabAmountInput value={vc} onValueChange={setVc} readOnly={kind === "original"} min="0.01" unit="VC" required />
      </LabField>
      {kind === "negotiated" && (
        <>
          <LabField label="报价依据">
            <textarea
              className={labInputClass}
              maxLength={4000}
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
            />
          </LabField>
          <LabField label="依据附件">
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []).map((file) => ({ id: uuidv4(), file })));
                setUploaded([]);
              }}
            />
          </LabField>
          {files.length > 0 && (
            <ul className="text-13">
              {files.map(({ id, file }, index) => (
                <li key={id}>
                  {file.name}
                  {uploaded[index] ? " · 已上传" : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </LabDialog>
  );
}

export const LabBountyQuotesPanel = observer(function LabBountyQuotesPanel({ store, bounty, onChanged }: Props) {
  const {
    data: loadedData,
    error: loadError,
    mutate,
  } = useSWR(
    ["lab-bounty-quotes", store.slug, bounty.id],
    () => store.request<LabBountyQuotes>(`bounties/${bounty.id}/quotes/`),
    { refreshInterval: 15000 }
  );
  const data = loadError ? undefined : loadedData;
  const [application, setApplication] = useState<"original" | "negotiated">();
  const [selection, setSelection] = useState<Decision>();
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function changed() {
    await mutate();
    await Promise.all([store.loadMarket(), store.loadPlanner()]);
    await onChanged?.();
  }
  function select(quote: LabBountyQuote, action: Decision["action"], decision?: Decision["decision"]) {
    setSelection({ quote, action, decision, key: uuidv4() });
    setReviewer(quote.reviewer_id ?? "");
    setReason("");
    setError("");
  }
  async function download(file: LabQuoteAttachment) {
    try {
      const { blob } = await store.download(file.download_path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "下载失败");
    }
  }
  const rejecting = selection?.action === "reject" || selection?.decision === "reject";
  const needsReviewer = selection?.action === "approve" && selection.quote.adjustment?.requires_review;
  return (
    <section className="my-3 flex flex-col gap-2" aria-label="悬赏报价">
      {(error || loadError) && (
        <p role="alert" className="text-13 text-danger-primary">
          {error || (loadError instanceof Error ? loadError.message : "报价加载失败")}
        </p>
      )}
      {data?.can_apply && (
        <div className="flex flex-wrap gap-2">
          {(labDecimalUnits(data.available) ?? 0n) > 0n && (
            <Button size="sm" onClick={() => setApplication("original")}>
              按原价申请 · {data.available} VC
            </Button>
          )}
          <Button size="sm" variant="neutral-primary" onClick={() => setApplication("negotiated")}>
            议价申请
          </Button>
        </div>
      )}
      {!!data?.quotes.length && (
        <details open={data.quotes.some((row) => row.status === "pending" || row.status === "pending_review")}>
          <summary className="cursor-pointer text-13 font-medium">报价记录（{data.quotes.length}）</summary>
          <div className="mt-2 flex flex-col gap-3">
            {data.quotes.map((quote) => (
              <article key={quote.id} className="rounded bg-layer-1 p-3 text-13">
                <p>
                  <strong>
                    {quote.name} · {quote.vc} VC
                  </strong>{" "}
                  · 第 {quote.revision} 次 · {quote.kind === "original" ? "原价申请" : "议价申请"} ·{" "}
                  {statuses[quote.status]}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{quote.deliverable}</p>
                {quote.basis && <p className="mt-1 whitespace-pre-wrap">{quote.basis}</p>}
                {quote.attachments.map((file) => (
                  <Button key={file.id} size="sm" variant="link-primary" onClick={() => void download(file)}>
                    {file.name}
                  </Button>
                ))}
                <ol className="my-2 text-12 text-secondary">
                  {quote.history.map((event) => (
                    <li key={event.id}>
                      {event.label} · {event.actor} ·{" "}
                      {new Date(event.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                      {event.reason && ` · ${event.reason}`}
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  {quote.can_approve && (
                    <Button size="sm" onClick={() => select(quote, "approve")}>
                      审批报价
                    </Button>
                  )}
                  {quote.can_reject && (
                    <Button size="sm" variant="neutral-primary" onClick={() => select(quote, "reject")}>
                      驳回申请
                    </Button>
                  )}
                  {quote.can_review && (
                    <>
                      <Button size="sm" onClick={() => select(quote, "review", "approve")}>
                        复核加价
                      </Button>
                      <Button size="sm" variant="neutral-primary" onClick={() => select(quote, "review", "reject")}>
                        驳回加价
                      </Button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
      {application && data && (
        <QuoteApplication
          store={store}
          bounty={bounty}
          data={data}
          kind={application}
          onClose={() => setApplication(undefined)}
          onChanged={changed}
          refresh={mutate}
        />
      )}
      {selection && (
        <LabDialog
          title={rejecting ? "驳回申请" : selection.action === "review" ? "复核加价" : "审批报价"}
          busy={busy}
          onClose={() => setSelection(undefined)}
          submitLabel={rejecting ? "确认驳回" : needsReviewer ? "同意并提交复核" : "批准承接"}
          error={error}
          submitDisabled={
            rejecting ? !reason.trim() : !selection.quote.adjustment?.funded || (!!needsReviewer && !reviewer)
          }
          onSubmit={async () => {
            setBusy(true);
            setError("");
            try {
              await store.request(`bounties/${bounty.id}/quotes/${selection.quote.id}/${selection.action}/`, "POST", {
                request_key: selection.key,
                expected_budget: selection.quote.budget_snapshot,
                reason,
                ...(needsReviewer ? { reviewer_id: reviewer } : {}),
                ...(selection.decision ? { decision: selection.decision } : {}),
              });
              setSelection(undefined);
              await changed();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "审批失败");
              try {
                const latest = await mutate();
                const quote = latest?.quotes.find((row) => row.id === selection.quote.id);
                if (quote) {
                  const allowed =
                    selection.action === "approve"
                      ? quote.can_approve
                      : selection.action === "reject"
                        ? quote.can_reject
                        : quote.can_review;
                  setSelection(allowed ? { ...selection, quote, key: uuidv4() } : undefined);
                }
              } catch {
                /* Keep the original error. */
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            {selection.quote.name} · {selection.quote.vc} VC
          </p>
          {!rejecting && selection.quote.adjustment && (
            <dl className="text-13">
              <dt>追加 VC</dt>
              <dd>{selection.quote.adjustment.additional}</dd>
              <dt>追加后悬赏总 VC</dt>
              <dd>{selection.quote.adjustment.next_budget}</dd>
              <dt>原属预算剩余 VC</dt>
              <dd>{selection.quote.adjustment.source_available}</dd>
              {!selection.quote.adjustment.funded && <dd role="alert">原属预算余额不足</dd>}
            </dl>
          )}
          {needsReviewer && (
            <LabField label="加价复核人">
              <select
                className={labInputClass}
                required
                value={reviewer}
                onChange={(event) => setReviewer(event.target.value)}
              >
                <option value="">请选择</option>
                {data?.reviewers
                  .filter((row) => row.id !== selection.quote.user_id)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </LabField>
          )}
          <LabField label="处理意见">
            <textarea
              className={labInputClass}
              required={rejecting}
              maxLength={4000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </LabField>
        </LabDialog>
      )}
    </section>
  );
});
