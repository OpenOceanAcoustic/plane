import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { PageHeading, useData, ErrorMessage, ActionButton } from "../../components/ui";
import { LabDialog, LabField, labInputClass } from "../lab/ui";
import { workspacePath, type WorkspaceProps } from "./business";
import { Status, widgetNames } from "./shared";
export type HomePreference = { key: string; is_enabled: boolean; sort_order: number };
function orderBetween(rows: HomePreference[], index: number) {
  const before = rows[index - 1]?.sort_order;
  const after = rows[index + 1]?.sort_order;
  return before === undefined ? (after ?? 1) - 1 : after === undefined ? before + 1 : (before + after) / 2;
}
export default function Widgets(props: WorkspaceProps) {
  const base = workspacePath(props.workspaceSlug),
    result = useData<HomePreference[]>(props.client, `${base}/home-preferences/`);
  const [selected, setSelected] = useState<HomePreference>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [dragOrder, setDragOrder] = useState<HomePreference[]>();
  const drag = useRef<{ key: string; rows: HomePreference[] } | null>(null);
  const linkForm = useRef<HTMLFormElement>(null);
  // oxlint-disable-next-line unicorn/no-array-sort -- fresh copy supports Android WebViews before toSorted
  const rows = dragOrder ?? [...(result.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  async function change(key: string, body: Partial<HomePreference>) {
    setBusy(true);
    setError(undefined);
    try {
      await props.client.request(`${base}/home-preferences/${encodeURIComponent(key)}/`, "PATCH", body);
      await result.refresh();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setDragOrder(undefined);
    }
  }
  const finishDrag = async () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const index = current.rows.findIndex((row) => row.key === current.key),
      row = current.rows[index];
    if (!row) return;
    await change(row.key, { sort_order: orderBetween(current.rows, index) });
  };
  return (
    <>
      <PageHeading title="管理首页组件" />
      <Status loading={result.loading} error={result.error} empty={!rows.length} />
      <ErrorMessage error={error} />
      <div className="lab-section-heading">
        <h2>组件顺序</h2>
      </div>
      <div className="widget-order-list">
        {rows.map((row, index) => (
          <div className="widget-order-row" data-widget-key={row.key} key={row.key}>
            <button className="widget-order-name" onClick={() => setSelected(row)}>
              {index + 1}　{widgetNames[row.key] ?? row.key}
            </button>
            <button
              className="widget-drag-handle"
              type="button"
              aria-label={`拖动排序 ${widgetNames[row.key] ?? row.key}`}
              disabled={busy}
              onPointerDown={(event) => {
                drag.current = { key: row.key, rows: [...rows] };
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragOrder([...rows]);
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current) return;
                const target = document
                  .elementFromPoint(event.clientX, event.clientY)
                  ?.closest("[data-widget-key]")
                  ?.getAttribute("data-widget-key");
                if (!target || target === current.key) return;
                const from = current.rows.findIndex((value) => value.key === current.key),
                  to = current.rows.findIndex((value) => value.key === target);
                if (from < 0 || to < 0) return;
                const next = [...current.rows];
                next.splice(to, 0, next.splice(from, 1)[0]!);
                current.rows = next;
                setDragOrder(next);
              }}
              onPointerUp={() => void finishDrag()}
              onPointerCancel={() => {
                drag.current = null;
                setDragOrder(undefined);
              }}
              onKeyDown={(event) => {
                if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const target = index + (event.key === "ArrowUp" ? -1 : 1);
                if (target < 0 || target >= rows.length || busy) return;
                const next = [...rows];
                next.splice(target, 0, next.splice(index, 1)[0]!);
                setDragOrder(next);
                void change(row.key, { sort_order: orderBetween(next, target) });
              }}
            >
              <GripVertical size={18} />
            </button>
          </div>
        ))}
      </div>
      <div className="lab-section-heading">
        <h2>显示组件</h2>
      </div>
      {rows.map((row) => (
        <label className="settings-switch-row" key={row.key}>
          <span>{widgetNames[row.key] ?? row.key}</span>
          <input
            type="checkbox"
            checked={row.is_enabled}
            disabled={busy}
            onChange={(event) => void change(row.key, { is_enabled: event.target.checked })}
          />
        </label>
      ))}
      <div className="lab-section-heading">
        <h2>快捷链接</h2>
      </div>
      <form className="settings-profile-form" ref={linkForm} onSubmit={(event) => event.preventDefault()}>
        <LabField label="标题">
          <input className={labInputClass} name="title" required />
        </LabField>
        <LabField label="链接">
          <input className={labInputClass} name="url" type="url" required placeholder="https://" />
        </LabField>
        <ActionButton
          className="button primary"
          action={async () => {
            if (!linkForm.current?.reportValidity()) return;
            const form = new FormData(linkForm.current);
            const url = new URL(String(form.get("url")));
            if (!["http:", "https:"].includes(url.protocol)) throw new Error("请输入 HTTP 或 HTTPS 链接");
            await props.client.request(`${base}/quick-links/`, "POST", {
              title: String(form.get("title")).trim(),
              url: url.toString(),
            });
            linkForm.current.reset();
          }}
        >
          保存链接
        </ActionButton>
      </form>
      {selected && (
        <LabDialog
          title={`${widgetNames[selected.key] ?? selected.key}顺序`}
          onClose={() => setSelected(undefined)}
          onSubmit={async (data) => {
            await props.client.request(`${base}/home-preferences/${encodeURIComponent(selected.key)}/`, "PATCH", {
              sort_order: Number(data.get("sort_order")),
            });
            await result.refresh();
            setSelected(undefined);
          }}
        >
          <LabField label="排序值">
            <input
              className={labInputClass}
              type="number"
              step="any"
              name="sort_order"
              defaultValue={selected.sort_order}
              required
            />
          </LabField>
        </LabDialog>
      )}
    </>
  );
}
