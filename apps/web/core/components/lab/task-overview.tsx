/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { observer } from "mobx-react";
import useSWR from "swr";
import type { LabStore } from "@plane/shared-state";
import type { LabItem } from "@plane/types";
import { Button, LabBountyBadge } from "@plane/ui";
import { LabBountyMaterials } from "./bounty-materials";
import { LabItemOverviewSurface } from "./item-details";
import { LabBountyWorkflow } from "./workflow";

export const LabTaskOverview = observer(function LabTaskOverview({
  store,
  item,
  onClose,
  onSchedule,
  onAdjust,
}: {
  store: LabStore;
  item: Pick<LabItem, "title"> & Partial<Pick<LabItem, "bounty_id" | "issue_key" | "category_color" | "category_name">>;
  onClose: () => void;
  onSchedule?: () => void;
  onAdjust?: () => void;
}) {
  const { data, error, isLoading, isValidating } = useSWR(
    item.bounty_id ? ["lab-planning-task-overview", store.slug, item.bounty_id] : null,
    () => store.loadBountyDetail(item.bounty_id!),
    { revalidateOnMount: true, revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 0 }
  );
  const bounty =
    !error && !isValidating && data ? (store.bounties.find((row) => row.id === item.bounty_id) ?? data) : undefined;
  return (
    <LabItemOverviewSurface title="悬赏任务详情" onClose={onClose}>
      <div className="space-y-3">
        {item.issue_key && <p className="text-13 text-tertiary">{item.issue_key}</p>}
        <h2 className="text-20 font-semibold break-words">{item.title}</h2>
        <LabBountyBadge color={item.category_color} />
      </div>
      {isLoading && <p className="text-13 text-secondary">正在读取任务…</p>}
      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          {error instanceof Error ? error.message : "任务读取失败"}
        </p>
      )}
      {bounty && (
        <>
          <section aria-label="事项内容" className="space-y-4 text-13">
            <div>
              <h3 className="mb-2 font-medium">交付物</h3>
              <p className="break-words whitespace-pre-wrap">{bounty.deliverable}</p>
            </div>
            <div>
              <h3 className="mb-2 font-medium">验收标准</h3>
              <p className="break-words whitespace-pre-wrap">{bounty.criteria}</p>
            </div>
          </section>
          <dl className="grid grid-cols-2 gap-4 text-13">
            <div>
              <dt className="text-secondary">项目</dt>
              <dd className="mt-1">{bounty.project}</dd>
            </div>
            <div>
              <dt className="text-secondary">VC配额</dt>
              <dd className="mt-1">{bounty.budget} VC</dd>
            </div>
            <div>
              <dt className="text-secondary">事项类别</dt>
              <dd className="mt-1">{item.category_name ?? "未分类"}</dd>
            </div>
          </dl>
          {bounty.access_level !== "public" && (
            <>
              <LabBountyMaterials store={store} bounty={bounty} />
              <LabBountyWorkflow store={store} bounty={bounty} />
            </>
          )}
        </>
      )}
      <div className="flex gap-2">
        {(onAdjust || onSchedule) && (
          <Button variant="primary" onClick={onAdjust ?? onSchedule} disabled={store.busy}>
            {onAdjust ? "调整时间块" : "安排时间"}
          </Button>
        )}
        <a
          className="rounded px-3 py-2 text-13 text-accent-primary"
          href={`/${store.slug}/lab/bounties?bounty_id=${encodeURIComponent(item.bounty_id ?? "")}`}
        >
          打开悬赏大厅
        </a>
      </div>
    </LabItemOverviewSurface>
  );
});
