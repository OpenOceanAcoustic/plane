/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import useSWR from "swr";
import type { LabBounty, LabBountyMaterial } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";

type SharedSources = {
  document_versions: { id: string; name: string; created_at: string }[];
  attachments: { id: string; name: string }[];
};
type SharedDocument = { name: string; description_html: string; created_at: string };
export function LabBountyMaterials({ store, bounty }: { store: LabStore; bounty: LabBounty }) {
  const [sharing, setSharing] = useState(false);
  const [kind, setKind] = useState<"document_version" | "attachment">("document_version");
  const [viewed, setViewed] = useState<SharedDocument>();
  const [readError, setReadError] = useState("");
  const [revoking, setRevoking] = useState<LabBountyMaterial>();
  const { data, error, mutate } = useSWR(["bounty-materials", store.slug, bounty.id, bounty.can_manage_materials], () =>
    store.request<{ materials: LabBountyMaterial[]; sources?: SharedSources }>(
      `bounties/${bounty.id}/materials/${bounty.can_manage_materials ? "?sources=1" : ""}`
    )
  );
  const sources = kind === "document_version" ? data?.sources?.document_versions : data?.sources?.attachments;
  return (
    <section aria-label="悬赏共享资料" className="mt-4 space-y-2 rounded border border-subtle p-3">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-13 font-semibold">负责人显式共享的执行资料</h3>
        {bounty.can_manage_materials && (
          <Button size="sm" variant="neutral-primary" onClick={() => setSharing(true)}>
            共享附件／文档版本
          </Button>
        )}
      </div>
      {error && <p className="text-12 text-secondary">{error instanceof Error ? error.message : "资料暂不可读取"}</p>}
      {readError && (
        <p role="alert" className="text-13 text-danger-primary">
          {readError}
        </p>
      )}
      {data?.materials.map((material) => (
        <div key={material.id} className="flex flex-wrap items-center gap-2 rounded bg-layer-1 p-2 text-12">
          <span className="mr-auto">
            {material.label} · {material.kind === "document_version" ? "冻结文档版本" : "附件"}
          </span>
          {material.kind === "document_version" ? (
            <Button
              size="sm"
              variant="neutral-primary"
              onClick={() => {
                setReadError("");
                void store.execute(async () => {
                  try {
                    setViewed(await store.request<SharedDocument>(`bounties/${bounty.id}/materials/${material.id}/`));
                  } catch (failure) {
                    setReadError(failure instanceof Error ? failure.message : "资料读取失败，请重试");
                  }
                });
              }}
            >
              读取共享版本
            </Button>
          ) : (
            <a
              className="text-accent-primary"
              href={`${store.apiBase}/api/workspaces/${encodeURIComponent(store.slug)}/lab/bounties/${bounty.id}/materials/${material.id}/`}
              download
            >
              下载共享附件
            </a>
          )}
          {bounty.can_manage_materials && (
            <Button size="sm" variant="neutral-primary" onClick={() => setRevoking(material)}>
              撤回共享
            </Button>
          )}
        </div>
      ))}
      {data && !data.materials.length && <p className="text-12 text-secondary">尚无已共享的执行资料。</p>}
      {sharing && (
        <LabDialog
          title="显式共享执行资料"
          busy={store.busy}
          onClose={() => setSharing(false)}
          error={store.error}
          onSubmit={(form) =>
            store.execute(async () => {
              await store.request(`bounties/${bounty.id}/materials/`, "POST", {
                kind,
                label: form.get("label"),
                ...(kind === "document_version"
                  ? { page_version_id: form.get("source_id") }
                  : { attachment_id: form.get("source_id") }),
              });
              await mutate();
              setSharing(false);
            })
          }
        >
          <LabField label="资料类型">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as "document_version" | "attachment")}
              className={labInputClass}
            >
              <option value="document_version">文档版本</option>
              <option value="attachment">任务附件</option>
            </select>
          </LabField>
          <LabField label="选择具体资料">
            <select name="source_id" key={kind} required className={labInputClass}>
              <option value="">请选择</option>
              {sources?.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                  {"created_at" in source && typeof source.created_at === "string"
                    ? ` · ${source.created_at.slice(0, 16)}`
                    : ""}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="给参与成员显示的名称">
            <input name="label" required className={labInputClass} />
          </LabField>
        </LabDialog>
      )}
      {revoking && (
        <LabDialog
          title="撤回共享资料"
          busy={store.busy}
          onClose={() => setRevoking(undefined)}
          error={store.error}
          destructive
          submitLabel="撤回共享"
          onSubmit={() =>
            store.execute(async () => {
              await store.request(`bounties/${bounty.id}/materials/${revoking.id}/`, "DELETE");
              await mutate();
              setRevoking(undefined);
            })
          }
        >
          <p className="text-13">撤回 {revoking.label} 后，参与成员无法再通过此悬赏读取。</p>
        </LabDialog>
      )}
      {viewed && (
        <LabDialog title={viewed.name} busy={false} onClose={() => setViewed(undefined)}>
          <p className="text-12 text-secondary">
            共享版本创建于 {new Date(viewed.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
          </p>
          <p className="text-13 whitespace-pre-wrap">
            {new DOMParser().parseFromString(viewed.description_html, "text/html").body.textContent ||
              "此版本暂无文字内容"}
          </p>
        </LabDialog>
      )}
    </section>
  );
}
