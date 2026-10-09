/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import type { LabBounty, LabBountyStatus, LabItem, LabStatus } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog } from "@plane/ui";
import { LabBountyWorkflow } from "./workflow";

const statusNames: Record<LabBountyStatus, string> = {
  draft: "草稿",
  publication_review: "发布待复核",
  open: "开放认领",
  active: "进行中",
  review: "待验收",
  acceptance_review: "验收待复核",
  partial: "部分通过",
  rework: "返工",
  rejected: "不通过",
  done: "完成",
  cancelled: "已取消",
  deleted: "已删除",
};

export const LabBountyPlanningDialog = observer(function LabBountyPlanningDialog({
  store,
  item,
  requestedStatus,
  onClose,
}: {
  store: LabStore;
  item: LabItem;
  requestedStatus: LabStatus;
  onClose: () => void;
}) {
  const [bounty, setBounty] = useState<LabBounty>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const requestId = useRef(0);
  const bountyId = item.bounty_id;
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      if (!bountyId) throw new Error("悬赏标识缺失，请刷新个人规划");
      const detail = await store.request<LabBounty>(`bounties/${encodeURIComponent(bountyId)}/detail/`);
      if (mounted.current && currentRequest === requestId.current) setBounty(detail);
    } catch (failure: unknown) {
      if (mounted.current && currentRequest === requestId.current) {
        setBounty(undefined);
        setError(failure instanceof Error ? failure.message : "悬赏详情加载失败");
      }
    } finally {
      if (mounted.current && currentRequest === requestId.current) setLoading(false);
    }
  }, [bountyId, store]);
  useEffect(() => {
    mounted.current = true;
    setBounty(undefined);
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const detail = bounty?.id === bountyId ? bounty : undefined;
  return (
    <LabDialog title="悬赏任务办理" busy={store.busy} onClose={onClose} error={error}>
      <h2 className="text-16 font-medium break-words">{detail?.title ?? item.title}</h2>
      {loading && (
        <p role="status" className="text-13 text-secondary">
          正在加载悬赏…
        </p>
      )}
      {error && (
        <Button size="sm" variant="neutral-primary" onClick={() => void refresh()}>
          重试
        </Button>
      )}
      {detail && (
        <>
          <dl className="grid grid-cols-2 gap-3 text-13">
            <div>
              <dt className="text-secondary">VC 配额</dt>
              <dd className="mt-1 font-medium">{detail.budget} VC</dd>
            </div>
            <div>
              <dt className="text-secondary">当前状态</dt>
              <dd className="mt-1">{statusNames[detail.status]}</dd>
            </div>
          </dl>
          <LabBountyWorkflow
            store={store}
            bounty={detail}
            compact
            requestedStatus={requestedStatus}
            onChanged={refresh}
          />
        </>
      )}
    </LabDialog>
  );
});
