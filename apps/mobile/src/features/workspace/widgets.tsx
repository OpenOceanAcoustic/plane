import { useState } from "react";
import { useData, ErrorMessage } from "../../components/ui";
import { Button, LabDialog, LabField, labInputClass } from "../lab/ui";
import { workspacePath, type WorkspaceProps } from "./business";
import { Status, widgetNames } from "./shared";
export type HomePreference = { key: string; is_enabled: boolean; sort_order: number };
export default function Widgets(props: WorkspaceProps) {
  const base = workspacePath(props.workspaceSlug),
    result = useData<HomePreference[]>(props.client, `${base}/home-preferences/`);
  const [selected, setSelected] = useState<HomePreference>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  // oxlint-disable-next-line unicorn/no-array-sort -- Android 7 WebView supports ES2022; sort a fresh copy
  const rows = [...(result.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  async function change(key: string, body: Partial<HomePreference>) {
    setBusy(true);
    setError(undefined);
    try {
      await props.client.request(`${base}/home-preferences/${encodeURIComponent(key)}/`, "PATCH", body);
      await result.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="lab-heading">
        <h1>首页组件</h1>
      </div>
      <Status loading={result.loading} error={result.error} empty={!rows.length} />
      <ErrorMessage error={error} />
      <div className="lab-list">
        {rows.map((row, index) => (
          <article className="lab-card" key={row.key}>
            <div className="lab-heading">
              <h2>{widgetNames[row.key] ?? row.key}</h2>
              <label>
                <input
                  type="checkbox"
                  checked={row.is_enabled}
                  disabled={busy}
                  onChange={(event) => void change(row.key, { is_enabled: event.target.checked })}
                />{" "}
                显示
              </label>
            </div>
            <div className="lab-actions">
              <Button
                disabled={busy || index === 0}
                onClick={() => void change(row.key, { sort_order: (rows[index - 1]?.sort_order ?? 0) - 1 })}
              >
                上移
              </Button>
              <Button
                disabled={busy || index === rows.length - 1}
                onClick={() => void change(row.key, { sort_order: (rows[index + 1]?.sort_order ?? 0) + 1 })}
              >
                下移
              </Button>
              <Button onClick={() => setSelected(row)}>设置顺序</Button>
            </div>
          </article>
        ))}
      </div>
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
