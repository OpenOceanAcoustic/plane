import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWRInfinite from "swr/infinite";
import { useSWRConfig } from "swr";
import { CanonicalIcon, MobileHeaderContext } from "../components/navigation";
import { RichHtmlEditor } from "../components/rich-editor";
import { ErrorMessage, Html, Loading, PageHeading, Sheet, records } from "../components/ui";
import type { ApiClient } from "../lib/client";
import { requestMobileNavigation } from "../lib/mobile-navigation";

export type Sticky = {
  id: string;
  name?: string | null;
  description_html?: string | null;
  background_color?: string | null;
  created_at?: string;
  updated_at?: string;
};
type StickyPage = {
  results: Sticky[];
  next_cursor?: string;
  next_page_results?: boolean;
};
type StickyChanges = Pick<Sticky, "name" | "description_html" | "background_color">;

export const stickyColors = [
  { key: "gray", label: "灰色" },
  { key: "peach", label: "蜜桃色" },
  { key: "pink", label: "粉色" },
  { key: "orange", label: "黄色" },
  { key: "green", label: "绿色" },
  { key: "light-blue", label: "蓝色" },
  { key: "dark-blue", label: "深蓝色" },
  { key: "purple", label: "紫色" },
] as const;

function knownColor(value: unknown): string {
  return stickyColors.some((color) => color.key === value) ? String(value) : "";
}
export function stickyRecords(data: unknown): Sticky[] {
  return records(data).filter((note) => typeof note.id === "string") as Sticky[];
}
function stickyHtml(note?: Sticky): string {
  return typeof note?.description_html === "string" ? note.description_html : "";
}
function stickyName(note?: Sticky): string {
  return typeof note?.name === "string" ? note.name.trim() : "";
}
function contentText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}
function stickyDate(note: Sticky): { label: string; value: string } | undefined {
  const value = note.updated_at || note.created_at;
  if (!value) return;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return;
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const label = sameDay
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : `${date.getFullYear() === today.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${String(date.getDate()).padStart(2, "0")}日`;
  return { label, value };
}

export function StickyCard({
  note,
  onEdit,
  onMore,
}: {
  note: Sticky;
  onEdit: (note: Sticky) => void;
  onMore: (note: Sticky) => void;
}) {
  const title = stickyName(note);
  const html = stickyHtml(note);
  const hasContent = contentText(html).replaceAll("\u00a0", " ").trim() || /<(img|video|audio|table|hr)\b/i.test(html);
  const color = knownColor(note.background_color);
  const date = stickyDate(note);
  return (
    <article className="sticky-card">
      <button
        className="sticky-card-open"
        type="button"
        aria-label={title ? `编辑便签：${title}` : "编辑无标题便签"}
        onClick={() => onEdit(note)}
      />
      <div className="sticky-card-content">
        {title && <h3>{title}</h3>}
        {hasContent ? <Html html={html} /> : <p className="sticky-placeholder">空便签</p>}
        {(date || color) && (
          <div className="sticky-card-meta">
            {date && (
              <span>
                <CanonicalIcon name="plan" size={11} />
                <time dateTime={date.value}>{date.label}</time>
              </span>
            )}
            {color && (
              <span
                className={`sticky-color-dot sticky-color-${color}`}
                aria-label={stickyColors.find((item) => item.key === color)?.label}
              />
            )}
          </div>
        )}
      </div>
      <button className="icon-button sticky-card-more" aria-label="便签操作" onClick={() => onMore(note)}>
        <CanonicalIcon name="menu" size={18} />
      </button>
    </article>
  );
}

export function StickyEditor({
  note,
  onSave,
  onCancel,
}: {
  note?: Sticky;
  onSave: (values: StickyChanges) => Promise<void>;
  onCancel: () => void;
}) {
  const originalName = stickyName(note);
  const originalHtml = stickyHtml(note);
  const originalColor = knownColor(note?.background_color);
  const [name, setName] = useState(originalName);
  const [html, setHtml] = useState(originalHtml);
  const [color, setColor] = useState(originalColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const ref = useRef<HTMLElement>(null);
  const dirty = name !== originalName || html !== originalHtml || color !== originalColor;
  const requestCancel = () => {
    if (busy) return;
    if (dirty) setLeave(() => onCancel);
    else onCancel();
  };
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    ref.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const hasDialog = () =>
      [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some((el) => el.getClientRects().length);
    const back = (event: Event) => {
      if (event.defaultPrevented || hasDialog()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!busy) {
        if (dirty) setLeave(() => onCancel);
        else onCancel();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") back(event);
    };
    const navigate = (event: Event) => {
      if (event.defaultPrevented || (!dirty && !busy)) return;
      event.preventDefault();
      if (!busy) {
        const action = (event as CustomEvent<{ navigate: () => void }>).detail.navigate;
        setLeave(() => () => {
          onCancel();
          action();
        });
      }
    };
    window.addEventListener("mobileBack", back, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("mobileNavigate", navigate);
    return () => {
      window.removeEventListener("mobileBack", back, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mobileNavigate", navigate);
    };
  }, [busy, dirty, onCancel]);
  return (
    <section className="sticky-editor" ref={ref} tabIndex={-1}>
      <div className="sticky-editor-heading">
        <h2>{note ? "编辑便签" : "新建便签"}</h2>
        <button className="text-button" onClick={requestCancel} disabled={busy}>
          取消
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(undefined);
          const values: StickyChanges = {};
          if (!note || name !== originalName) values.name = name.trim() || null;
          if (!note || html !== originalHtml) values.description_html = html || "<p></p>";
          if (!note || color !== originalColor) values.background_color = color || null;
          try {
            await onSave(values);
            onCancel();
          } catch (cause) {
            setError(cause);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label className="field">
            <span>标题</span>
            <input aria-label="标题" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="field">
            <span>内容</span>
            {busy ? (
              <div className="sticky-saving-content">
                <Html html={html} />
              </div>
            ) : (
              <RichHtmlEditor value={html} onChange={setHtml} compact />
            )}
          </div>
          <label className="field">
            <span>颜色</span>
            <select aria-label="颜色" value={color} onChange={(event) => setColor(event.target.value)}>
              <option value="">默认</option>
              {stickyColors.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <ErrorMessage error={error} />
        <button className="button" type="submit" disabled={busy}>
          {busy ? "正在保存…" : "保存便签"}
        </button>
      </form>
      {leave && (
        <Sheet title="放弃修改？" onClose={() => setLeave(null)}>
          <div className="sticky-confirm-actions">
            <button className="button" onClick={() => setLeave(null)}>
              继续编辑
            </button>
            <button
              className="button danger"
              onClick={() => {
                setLeave(null);
                leave();
              }}
            >
              放弃修改
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

export function StickyActions({
  note,
  client,
  path,
  onClose,
  onEdit,
  onChanged,
}: {
  note: Sticky;
  client: ApiClient;
  path: string;
  onClose: () => void;
  onEdit: (note: Sticky) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Sheet title={confirm ? "删除便签？" : "便签操作"} onClose={onClose} busy={busy}>
      {confirm ? (
        <div className="sticky-confirm-actions">
          <button className="button" onClick={() => setConfirm(false)} disabled={busy}>
            取消
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError(undefined);
              try {
                await client.request(`${path}${encodeURIComponent(note.id)}/`, "DELETE");
                onClose();
                // The list owns read errors; a completed DELETE must not be repeated.
                void onChanged().catch(() => undefined);
              } catch (cause) {
                setError(cause);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在删除…" : "删除便签"}
          </button>
        </div>
      ) : (
        <div className="list">
          <button
            className="row"
            onClick={() => {
              onClose();
              onEdit(note);
            }}
          >
            编辑便签
          </button>
          <button className="row danger" onClick={() => setConfirm(true)}>
            删除便签
          </button>
        </div>
      )}
      <ErrorMessage error={error} />
    </Sheet>
  );
}

export default function Stickies({ client, workspaceSlug }: { client: ApiClient; workspaceSlug: string }) {
  const header = useContext(MobileHeaderContext);
  const path = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/stickies/`;
  const { mutate } = useSWRConfig();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Sticky | "new">();
  const [actions, setActions] = useState<Sticky>();
  const [colorPicker, setColorPicker] = useState(false);
  const feed = useSWRInfinite<StickyPage>(
    (index, previous: StickyPage | null) => {
      if (index && (!previous?.next_page_results || !previous.next_cursor)) return null;
      const cursor = index ? previous!.next_cursor! : "20:0:0";
      return [client.server, `${path}?${new URLSearchParams({ per_page: "20", cursor })}`];
    },
    ([, url]: [string, string]) => client.request<StickyPage>(url),
    { revalidateOnFocus: true, shouldRetryOnError: false }
  );
  const notes = [...new Map((feed.data ?? []).flatMap(stickyRecords).map((note) => [note.id, note])).values()];
  const lastPage = feed.data?.[feed.data.length - 1];
  const hasMore = Boolean(lastPage?.next_page_results && lastPage.next_cursor);
  const loadingMore = feed.isLoading || feed.size > (feed.data?.length ?? 0);
  const filtering = Boolean(query.trim() || filter);
  const { size, setSize, error: feedError } = feed;
  // The API query searches only body text. Read remaining pages before claiming a complete title/body search.
  useEffect(() => {
    if (filtering && hasMore && !loadingMore && !feedError) void setSize(size + 1);
  }, [filtering, hasMore, loadingMore, feedError, size, setSize]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = notes.filter(
    (note) =>
      (!filter || knownColor(note.background_color) === filter) &&
      (!needle || `${stickyName(note)} ${contentText(stickyHtml(note))}`.toLocaleLowerCase().includes(needle))
  );
  const refresh = async () => {
    await feed.mutate();
    await mutate((key) => Array.isArray(key) && key[0] === client.server && key[1] === path);
  };
  const closeEditor = () => setEditing(undefined);
  const openEditor = (note: Sticky) => {
    if (editing !== "new" && editing?.id === note.id) return;
    requestMobileNavigation(() => setEditing(note));
  };
  const openActions = (note: Sticky) =>
    requestMobileNavigation(() => {
      closeEditor();
      setActions(note);
    });
  const createAction = (
    <div className="sticky-action-bar">
      <button
        className="button primary"
        disabled={editing === "new"}
        onClick={() => requestMobileNavigation(() => setEditing("new"))}
      >
        新建便签
      </button>
    </div>
  );
  return (
    <div className="stickies-content">
      <PageHeading title="便签" />
      <label className="field sticky-search">
        <span>搜索便签</span>
        <input
          aria-label="搜索便签"
          placeholder="搜索标题或内容…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="sticky-filters">
        {[
          { key: "", label: "全部" },
          ...["orange", "light-blue", "green"].map((key) => stickyColors.find((color) => color.key === key)!),
        ].map((color) => (
          <button
            key={color.key}
            className={`chip ${filter === color.key ? "active" : ""}`}
            aria-pressed={filter === color.key}
            onClick={() => setFilter(color.key)}
          >
            {color.label}
          </button>
        ))}
        <button
          className="icon-button sticky-more-colors"
          aria-label="其他便签颜色"
          onClick={() => setColorPicker(true)}
        >
          <CanonicalIcon name="menu" size={18} />
        </button>
      </div>
      <ErrorMessage error={feed.error} />
      {feed.isLoading && <Loading />}
      <div className="sticky-list">
        {visible.map((note) => (
          <StickyCard key={note.id} note={note} onEdit={openEditor} onMore={openActions} />
        ))}
      </div>
      {!feed.isLoading && !visible.length && !feed.error && !(filtering && hasMore) && (
        <p className="empty">{filtering ? "没有匹配的便签" : "暂无便签"}</p>
      )}
      {filtering && !feed.error && (hasMore || loadingMore) ? (
        <p className="sticky-loading" role="status">
          {query.trim() ? "正在搜索便签…" : "正在筛选便签…"}
        </p>
      ) : (
        hasMore && (
          <button
            className="button sticky-load-more"
            disabled={loadingMore}
            onClick={() => {
              void feed.setSize(feed.size + 1);
            }}
          >
            {loadingMore ? "正在加载…" : "查看更多"}
          </button>
        )
      )}
      {feed.error && (
        <button
          className="text-button"
          onClick={() => {
            void feed.mutate();
          }}
        >
          重试
        </button>
      )}
      {editing && (
        <StickyEditor
          key={editing === "new" ? "new" : editing.id}
          note={editing === "new" ? undefined : editing}
          onCancel={closeEditor}
          onSave={async (values) => {
            if (editing === "new") await client.request(path, "POST", values);
            else if (Object.keys(values).length)
              await client.request(`${path}${encodeURIComponent(editing.id)}/`, "PATCH", values);
            // Close after the write succeeds, even if the subsequent list read fails.
            void refresh().catch(() => undefined);
          }}
        />
      )}
      {actions && (
        <StickyActions
          note={actions}
          client={client}
          path={path}
          onClose={() => setActions(undefined)}
          onEdit={openEditor}
          onChanged={refresh}
        />
      )}
      {colorPicker && (
        <Sheet title="便签颜色" onClose={() => setColorPicker(false)}>
          <div className="list">
            {stickyColors.map((color) => (
              <button
                className="row"
                key={color.key}
                onClick={() => {
                  setFilter(color.key);
                  setColorPicker(false);
                }}
              >
                <span className={`sticky-color-dot sticky-color-${color.key}`} />
                <span>{color.label}</span>
                {filter === color.key && <CanonicalIcon name="check" size={16} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {header?.composer ? createPortal(createAction, header.composer) : createAction}
    </div>
  );
}
