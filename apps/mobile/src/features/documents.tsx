import { useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { AnyExtension } from "@tiptap/core";
import { Collaboration } from "@tiptap/extension-collaboration";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { TITLE_EDITOR_EXTENSIONS } from "@plane/editor/lib";
import * as Y from "yjs";
import { mobileEditorExtensions } from "../components/rich-editor";
import type { ApiClient } from "../lib/client";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Html,
  Loading,
  PageHeading,
  RecordList,
  Sheet,
  records,
  textValue,
  useData,
  type Entity,
} from "../components/ui";

type Props = {
  client: ApiClient;
  workspaceSlug: string;
  projectId?: string;
  pageId?: string;
  onOpen: (projectId: string, pageId: string) => void;
};
export default function Documents(props: Props) {
  const projects = useData(props.client, `/api/workspaces/${props.workspaceSlug}/projects/`);
  const [selected, setSelected] = useState(props.projectId ?? "");
  const projectId = props.projectId || selected;
  return (
    <>
      <PageHeading title="文档" />
      {!props.projectId && (
        <label className="field">
          <span>项目</span>
          <select aria-label="项目" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">选择项目</option>
            {records(projects.data).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ErrorMessage error={projects.error} />
      {projectId &&
        (props.pageId ? (
          <DocumentDetail {...props} projectId={projectId} pageId={props.pageId} />
        ) : (
          <DocumentList {...props} projectId={projectId} />
        ))}
    </>
  );
}
function DocumentList({ client, workspaceSlug, projectId, onOpen }: Props & { projectId: string }) {
  const path = `/api/workspaces/${workspaceSlug}/projects/${projectId}/pages/`;
  const pages = useData(client, path);
  const [create, setCreate] = useState(false);
  return (
    <>
      <button className="button" onClick={() => setCreate(true)}>
        新建文档
      </button>
      <ErrorMessage error={pages.error} />
      {pages.loading ? (
        <Loading />
      ) : (
        <RecordList
          data={pages.data}
          fields={["updated_at", "access", "is_locked"]}
          onOpen={(page) => onOpen(projectId, String(page.id))}
        />
      )}
      {create && (
        <FormSheet
          title="新建文档"
          fields={[
            { key: "name", label: "标题", required: true },
            {
              key: "access",
              label: "访问",
              type: "select",
              value: "0",
              options: [
                { value: "0", label: "项目成员" },
                { value: "1", label: "仅自己" },
              ],
            },
          ]}
          onClose={() => setCreate(false)}
          onSubmit={async (values) => {
            const page = await client.request<Entity>(path, "POST", { ...values, access: Number(values.access) });
            await pages.refresh();
            onOpen(projectId, String(page.id));
          }}
        />
      )}
    </>
  );
}
function DocumentDetail({
  client,
  workspaceSlug,
  projectId,
  pageId,
  onOpen,
}: Props & { projectId: string; pageId: string }) {
  const path = `/api/workspaces/${workspaceSlug}/projects/${projectId}/pages/${pageId}/`;
  const page = useData<Entity>(client, path);
  const [menu, setMenu] = useState(false);
  const [versions, setVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<Entity>();
  const [editAccess, setEditAccess] = useState(false);
  const history = useData(client, versions ? `${path}versions/` : null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [synced, setSynced] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [status, setStatus] = useState("连接中");
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const document = new Y.Doc();
    const url = new URL("/live/collaboration", `${client.server}/`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const live = new HocuspocusProvider({
      url: url.toString(),
      name: pageId,
      document,
      parameters: { workspaceSlug, projectId, documentType: "project_page" },
      token: async () => {
        const ticket = await client.request<{ ticket: string; read_only?: boolean }>(
          `/api/workspaces/${workspaceSlug}/lab/live-ticket/`,
          "POST",
          { project_id: projectId, page_id: pageId }
        );
        setReadOnly(ticket.read_only !== false);
        return JSON.stringify({ ticket: ticket.ticket });
      },
      onSynced: ({ state }) => {
        setSynced(state);
        if (state) setStatus("已同步");
      },
      onStatus: ({ status: next }) => {
        if (next !== "connected") {
          setSynced(false);
          setStatus(next === "disconnected" ? "连接已断开" : "连接中");
        }
      },
      onAuthenticationFailed: ({ reason }) => {
        setError(new Error(reason || "文档认证失败"));
        setReadOnly(true);
      },
    });
    live.on("unsyncedChanges", (number: number) => setStatus(number ? "同步中…" : "已同步"));
    setProvider(live);
    const back = (event: Event) => {
      if (live.hasUnsyncedChanges && !window.confirm("文档仍在同步，离开此页面？")) event.preventDefault();
    };
    window.addEventListener("mobileBack", back);
    return () => {
      window.removeEventListener("mobileBack", back);
      live.destroy();
      document.destroy();
      setProvider(null);
    };
  }, [client, workspaceSlug, projectId, pageId]);
  return (
    <>
      <div className="section-heading">
        <span className="muted" role="status">
          {status}
        </span>
        <button className="button" onClick={() => setMenu(true)}>
          文档操作
        </button>
      </div>
      <ErrorMessage error={page.error ?? error} />
      {page.loading ? (
        <Loading />
      ) : provider && synced ? (
        <CollaborativeEditors
          provider={provider}
          writable={!readOnly && !page.data?.is_locked}
          client={client}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          pageId={pageId}
        />
      ) : (
        <>
          <h1>{textValue(page.data?.name)}</h1>
          <Html html={page.data?.description_html} />
        </>
      )}
      {menu && (
        <Sheet title="文档操作" onClose={() => setMenu(false)}>
          <div className="list">
            <ActionButton
              action={() => client.request(`${path}duplicate/`, "POST")}
              onDone={() => {
                setMenu(false);
              }}
            >
              复制文档
            </ActionButton>
            <ActionButton
              action={() => client.request(`${path}archive/`, page.data?.archived_at ? "DELETE" : "POST")}
              onDone={() => {
                void page.refresh();
                setMenu(false);
              }}
            >
              {page.data?.archived_at ? "恢复文档" : "归档"}
            </ActionButton>
            <ActionButton
              action={() => client.request(`${path}lock/`, page.data?.is_locked ? "DELETE" : "POST")}
              onDone={() => {
                void page.refresh();
                setMenu(false);
              }}
            >
              {page.data?.is_locked ? "解锁" : "锁定"}
            </ActionButton>
            <ActionButton
              action={() =>
                client.request(
                  `/api/workspaces/${workspaceSlug}/projects/${projectId}/favorite-pages/${pageId}/`,
                  page.data?.is_favorite ? "DELETE" : "POST"
                )
              }
              onDone={() => {
                void page.refresh();
              }}
            >
              {page.data?.is_favorite ? "取消收藏" : "收藏"}
            </ActionButton>
            <button
              className="button"
              onClick={() => {
                setMenu(false);
                setEditAccess(true);
              }}
            >
              访问权限
            </button>
            <button
              className="button"
              onClick={() => {
                setMenu(false);
                setVersions(true);
              }}
            >
              版本记录
            </button>
            <ActionButton
              action={async () => {
                if (window.confirm("删除此文档？")) {
                  await client.request(path, "DELETE");
                  onOpen(projectId, "");
                }
              }}
              className="button danger"
            >
              删除文档
            </ActionButton>
          </div>
        </Sheet>
      )}
      {editAccess && (
        <FormSheet
          title="访问权限"
          fields={[
            {
              key: "access",
              label: "访问",
              type: "select",
              value: page.data?.access,
              options: [
                { value: "0", label: "项目成员" },
                { value: "1", label: "仅自己" },
              ],
            },
          ]}
          onClose={() => setEditAccess(false)}
          onSubmit={async (values) => {
            await client.request(`${path}access/`, "POST", { access: Number(values.access) });
            await page.refresh();
          }}
        />
      )}
      {selectedVersion && (
        <Sheet title="历史版本" onClose={() => setSelectedVersion(undefined)}>
          <p className="muted">{textValue(selectedVersion.created_at)}</p>
          <Html html={selectedVersion.description_html} />
        </Sheet>
      )}
      {versions && (
        <Sheet title="版本记录" onClose={() => setVersions(false)}>
          <ErrorMessage error={history.error} />
          <RecordList
            data={history.data}
            fields={["created_at", "created_by"]}
            onOpen={(version) => {
              void client
                .request<Entity>(`${path}versions/${version.id}/`)
                .then((result) => {
                  setError(undefined);
                  setVersions(false);
                  setSelectedVersion(result);
                  return undefined;
                })
                .catch(setError);
            }}
          />
        </Sheet>
      )}
    </>
  );
}
function CollaborativeEditors({
  provider,
  writable,
  client,
  workspaceSlug,
  projectId,
  pageId,
}: {
  provider: HocuspocusProvider;
  writable: boolean;
  client: ApiClient;
  workspaceSlug: string;
  projectId: string;
  pageId: string;
}) {
  const [error, setError] = useState<unknown>();
  const [insert, setInsert] = useState<string | null>(null);
  const extensions = useMemo(
    () =>
      [
        ...mobileEditorExtensions(client, true),
        Collaboration.configure({ document: provider.document, field: "default" }),
      ] as AnyExtension[],
    [provider, client]
  );
  const editor = useEditor(
    {
      extensions,
      editable: writable,
      editorProps: { attributes: { class: "document-body", "aria-label": "文档正文" } },
    },
    [provider]
  );
  const title = useEditor(
    {
      extensions: [
        ...TITLE_EDITOR_EXTENSIONS,
        Collaboration.configure({ document: provider.document, field: "title" }),
      ],
      editable: writable,
      editorProps: { attributes: { class: "document-title", "aria-label": "文档标题" } },
    },
    [provider]
  );
  useEffect(() => {
    editor?.setEditable(writable);
    title?.setEditable(writable);
  }, [editor, title, writable]);
  if (!editor || !title) return <Loading />;
  const run = (name: string) => {
    const chain = editor.chain().focus();
    if (name === "bold") chain.toggleMark("bold").run();
    if (name === "italic") chain.toggleMark("italic").run();
    if (name === "underline") chain.toggleMark("underline").run();
    if (name === "bullet") chain.toggleList("bulletList", "listItem").run();
    if (name === "number") chain.toggleList("orderedList", "listItem").run();
    if (name === "todo") chain.toggleList("taskList", "taskItem").run();
    if (name === "quote") chain.toggleNode("blockquote", "paragraph").run();
    if (name === "code") chain.toggleNode("codeBlock", "paragraph").run();
  };
  return (
    <>
      <EditorContent editor={title} />
      {writable && (
        <div className="editor-toolbar">
          <select
            aria-label="段落样式"
            onChange={(e) => {
              if (e.target.value === "p") editor.chain().focus().setNode("paragraph").run();
              else
                editor
                  .chain()
                  .focus()
                  .setNode("heading", { level: Number(e.target.value) })
                  .run();
            }}
          >
            <option value="p">正文</option>
            <option value="1">标题 1</option>
            <option value="2">标题 2</option>
            <option value="3">标题 3</option>
          </select>
          {[
            ["bold", "粗体"],
            ["italic", "斜体"],
            ["underline", "下划线"],
            ["bullet", "列表"],
            ["number", "编号"],
            ["todo", "待办"],
            ["quote", "引用"],
            ["code", "代码"],
          ].map(([name, label]) => (
            <button className="chip" key={name} onClick={() => run(name)}>
              {label}
            </button>
          ))}
          <button className="chip" onClick={() => setInsert("link")}>
            链接
          </button>
          <button className="chip" onClick={() => setInsert("table")}>
            表格
          </button>
          <ActionButton
            className="chip"
            action={async () => {
              const file = await client.pickFile("image/*");
              const assetPath = `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/`;
              const signed = await client.request<{
                asset_id: string;
                upload_data: { url: string; fields: Record<string, string> };
              }>(assetPath, "POST", {
                name: file.name,
                size: file.size,
                type: file.mimeType,
                entity_type: "PAGE_DESCRIPTION",
                entity_identifier: pageId,
              });
              await client.uploadFile(signed.upload_data.url, file, signed.upload_data.fields);
              await client.request(`${assetPath}${signed.asset_id}/`, "PATCH");
              editor
                .chain()
                .focus()
                .insertContent({ type: "image", attrs: { src: `${client.server}${assetPath}${signed.asset_id}/` } })
                .run();
            }}
          >
            图片
          </ActionButton>
        </div>
      )}
      <ErrorMessage error={error} />
      <EditorContent editor={editor} />
      {insert && (
        <FormSheet
          title={insert === "link" ? "插入链接" : "插入表格"}
          onClose={() => setInsert(null)}
          fields={
            insert === "link"
              ? [{ key: "url", label: "链接", type: "url", required: true }]
              : [
                  { key: "rows", label: "行数", type: "number", value: 3, required: true },
                  { key: "cols", label: "列数", type: "number", value: 2, required: true },
                ]
          }
          onSubmit={async (values) => {
            try {
              if (insert === "link") editor.chain().focus().setMark("link", { href: values.url }).run();
              else
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "table",
                    content: Array.from({ length: Math.max(1, Math.min(30, Number(values.rows))) }, (_, index) => ({
                      type: "tableRow",
                      content: Array.from({ length: Math.max(1, Math.min(10, Number(values.cols))) }, () => ({
                        type: index === 0 ? "tableHeader" : "tableCell",
                        content: [{ type: "paragraph" }],
                      })),
                    })),
                  })
                  .run();
            } catch (err) {
              setError(err);
              throw err;
            }
          }}
        />
      )}
    </>
  );
}
