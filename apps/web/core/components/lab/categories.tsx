/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { observer } from "mobx-react";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import type { LabCategory } from "@plane/types";
import type { LabStore } from "@plane/shared-state";
import { Button, LabColorPicker, LabDialog, LabField, labInputClass } from "@plane/ui";

export const LabCategoryManager = observer(function LabCategoryManager({ store }: { store: LabStore }) {
  const [mode, setMode] = useState<"list" | "edit" | "delete">();
  const [category, setCategory] = useState<LabCategory>();
  const close = () => {
    setMode(undefined);
    setCategory(undefined);
  };
  const mutate = (method: string, body?: unknown) =>
    store.execute(async () => {
      await store.request(category ? `categories/${category.id}/` : "categories/", method, body);
      close();
      await store.loadPlanner();
    });
  return (
    <>
      <Button
        size="sm"
        variant="neutral-primary"
        prependIcon={<Tags size={14} />}
        onClick={() => {
          store.error = "";
          setMode("list");
        }}
      >
        管理类别
      </Button>
      {mode === "list" && (
        <LabDialog
          title="事项类别"
          submitLabel="完成"
          busy={store.busy}
          error={store.error}
          onClose={close}
          onSubmit={async () => close()}
        >
          <Button
            variant="neutral-primary"
            prependIcon={<Plus size={14} />}
            onClick={() => {
              setCategory(undefined);
              setMode("edit");
            }}
          >
            新增类别
          </Button>
          <ul className="space-y-2" aria-label="本人事项类别">
            {(store.planner?.categories ?? []).map((row) => (
              <li key={row.id} className="flex items-center gap-3 rounded-md border border-subtle p-3 text-13">
                <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="min-w-0 flex-1 break-words">{row.name}</span>
                <button
                  type="button"
                  className="rounded p-1.5 hover:bg-layer-1"
                  aria-label={`编辑类别${row.name}`}
                  onClick={() => {
                    setCategory(row);
                    setMode("edit");
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-danger-primary hover:bg-layer-1"
                  aria-label={`删除类别${row.name}`}
                  onClick={() => {
                    setCategory(row);
                    setMode("delete");
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          {!store.planner?.categories?.length && (
            <p className="text-13 text-secondary">暂无类别，可新增后为事项选择。</p>
          )}
        </LabDialog>
      )}
      {mode === "edit" && (
        <LabDialog
          key={category?.id ?? "new"}
          title={category ? "编辑类别" : "新增类别"}
          busy={store.busy}
          error={store.error}
          onClose={close}
          onSubmit={(data) => mutate(category ? "PATCH" : "POST", { name: data.get("name"), color: data.get("color") })}
        >
          <LabField label="类别名称">
            <input className={labInputClass} name="name" defaultValue={category?.name ?? ""} required maxLength={40} />
          </LabField>
          <LabColorPicker label="类别颜色" initialValue={category?.color ?? "#7c3aed"} />
        </LabDialog>
      )}
      {mode === "delete" && category && (
        <LabDialog
          title={`删除类别 ${category.name}`}
          busy={store.busy}
          error={store.error}
          destructive
          submitLabel="删除"
          onClose={close}
          onSubmit={() => mutate("DELETE")}
        >
          <p className="text-13 text-secondary">事项和排期会保留，类别回到“未分类”。单独选择的排期颜色会保留。</p>
        </LabDialog>
      )}
    </>
  );
});
