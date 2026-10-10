import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type AnyExtension } from "@tiptap/core";
import { CoreEditorExtensionsWithoutProps, DocumentEditorExtensionsWithoutProps } from "@plane/editor/lib";
import type { ApiClient } from "../lib/client";

export const MobileClientContext = createContext<ApiClient | null>(null);
export function bitmapMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "image/gif";
  if (
    bytes[0] === 82 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80
  )
    return "image/webp";
  return null;
}
export async function resolveImage(client: ApiClient, source: string): Promise<string> {
  const url = new URL(source, `${client.server}/`);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("图片地址无效");
  if (url.origin !== new URL(client.server).origin || !url.pathname.startsWith("/api/assets/")) return url.toString();
  const bytes = await client.binary(`${url.pathname}${url.search}`);
  const mime = bitmapMime(bytes);
  if (!mime) throw new Error("图片格式无法预览");
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
}
export function mobileEditorExtensions(client: ApiClient | null, collaboration = false): AnyExtension[] {
  const utility = Extension.create({
    name: "utility",
    addStorage() {
      return {
        isTouchDevice: true,
        assetsList: [],
        assetsUploadStatus: {},
        uploadInProgress: false,
        activeDropbarExtensions: [],
      };
    },
  });
  return [utility, ...CoreEditorExtensionsWithoutProps, ...DocumentEditorExtensionsWithoutProps].map((extension) => {
    if (collaboration && extension.name === "starterKit") return extension.configure({ history: false });
    if (client && ["image", "imageComponent"].includes(extension.name))
      return extension.extend({
        addNodeView() {
          return ({ node }) => {
            const wrapper = document.createElement("figure");
            wrapper.className = "mobile-editor-image";
            const image = document.createElement("img");
            image.alt = String(node.attrs.alt ?? "图片");
            image.referrerPolicy = "no-referrer";
            wrapper.append(image);
            let active = true;
            let blobUrl: string | undefined;
            const load = async (src: string) => {
              try {
                const url = await resolveImage(client, src);
                if (!active) {
                  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
                  return;
                }
                if (blobUrl) URL.revokeObjectURL(blobUrl);
                blobUrl = url.startsWith("blob:") ? url : undefined;
                image.src = url;
              } catch {
                image.alt = "图片加载失败";
              }
            };
            void load(String(node.attrs.src ?? ""));
            return {
              dom: wrapper,
              update(next) {
                if (next.type !== node.type) return false;
                if (next.attrs.src !== node.attrs.src) void load(String(next.attrs.src ?? ""));
                node = next;
                return true;
              },
              destroy() {
                active = false;
                if (blobUrl) URL.revokeObjectURL(blobUrl);
              },
            };
          };
        },
      });
    return extension;
  }) as AnyExtension[];
}
export function RichHtmlEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const client = useContext(MobileClientContext);
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [linkError, setLinkError] = useState("");
  const extensions = useMemo(() => mobileEditorExtensions(client), [client]);
  const editor = useEditor({
    extensions,
    content: value || "<p></p>",
    editorProps: { attributes: { class: "document-body", "aria-label": "富文本内容" } },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });
  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || "<p></p>", false);
  }, [editor, value]);
  if (!editor) return null;
  return (
    <div className="rich-input">
      <div className="editor-toolbar">
        <button type="button" className="chip" onClick={() => editor.chain().focus().toggleMark("bold").run()}>
          粗体
        </button>
        <button type="button" className="chip" onClick={() => editor.chain().focus().toggleMark("italic").run()}>
          斜体
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => editor.chain().focus().toggleList("bulletList", "listItem").run()}
        >
          列表
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => editor.chain().focus().toggleList("taskList", "taskItem").run()}
        >
          待办
        </button>
        <button type="button" className="chip" onClick={() => setShowLink(!showLink)}>
          链接
        </button>
      </div>
      {showLink && (
        <div className="search-field">
          <input aria-label="插入链接" type="url" value={link} onChange={(event) => setLink(event.target.value)} />
          <button
            type="button"
            className="text-button"
            onClick={() => {
              try {
                const url = new URL(link);
                if (!["https:", "http:"].includes(url.protocol)) throw new Error("请输入 HTTP 或 HTTPS 链接");
                editor.chain().focus().setMark("link", { href: url.toString() }).run();
                setLinkError("");
                setShowLink(false);
              } catch {
                setLinkError("请输入 HTTP 或 HTTPS 链接");
              }
            }}
          >
            插入
          </button>
        </div>
      )}
      {linkError && (
        <p role="alert" className="error">
          {linkError}
        </p>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
