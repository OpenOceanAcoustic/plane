import { PageHeading } from "../../components/ui";
import { useState } from "react";
import { useData, type Entity } from "../../components/ui";
import { Button, LabDialog, LabField, labInputClass } from "../lab/ui";
import type { WorkspaceProps } from "./business";
import { Status, useWorkspace } from "./shared";
const commands = [
  { page: "projects", name: "项目与任务" },
  { page: "drafts", name: "草稿箱" },
  { page: "planner", name: "个人排期" },
  { page: "bounties", name: "悬赏" },
  { page: "documents", name: "项目文档" },
  { page: "inbox", name: "站内通知" },
  { page: "search", name: "搜索" },
];
export default function Commands(props: WorkspaceProps) {
  const { base } = useWorkspace(props),
    links = useData<Entity[]>(props.client, `${base}/quick-links/`),
    [modal, setModal] = useState<"create" | "edit" | "delete">(),
    [selected, setSelected] = useState<Entity>();
  return (
    <>
      <PageHeading title="快捷入口" />
      <div className="lab-list">
        {commands.map((command) => (
          <button
            key={command.page}
            className="lab-card workspace-command"
            onClick={() => props.onNavigate({ page: command.page })}
          >
            <strong>{command.name}</strong>
          </button>
        ))}
      </div>
      <div className="lab-heading">
        <h2>我的快捷链接</h2>
        <Button
          onClick={() => {
            setSelected(undefined);
            setModal("create");
          }}
        >
          添加链接
        </Button>
      </div>
      <Status loading={links.loading} error={links.error} empty={!links.data?.length} />
      <div className="lab-list">
        {links.data?.map((link) => (
          <article className="lab-card" key={link.id}>
            {validUrl(link.url) ? (
              <a className="record-title" href={String(link.url)} target="_blank" rel="noopener noreferrer">
                {String(link.title ?? link.url)}
              </a>
            ) : (
              <h3>{String(link.title ?? "链接")}</h3>
            )}
            <p className="lab-muted workspace-url">{String(link.url)}</p>
            <div className="lab-actions">
              <Button
                onClick={() => {
                  setSelected(link);
                  setModal("edit");
                }}
              >
                编辑
              </Button>
              <Button
                onClick={() => {
                  setSelected(link);
                  setModal("delete");
                }}
              >
                删除
              </Button>
            </div>
          </article>
        ))}
      </div>
      {(modal === "create" || modal === "edit") && (
        <LabDialog
          title={modal === "edit" ? "编辑快捷链接" : "添加快捷链接"}
          onClose={() => setModal(undefined)}
          onSubmit={async (data) => {
            const url = String(data.get("url") ?? "").trim();
            if (!validUrl(url)) throw new Error("请输入完整 HTTP 或 HTTPS 链接");
            await props.client.request(
              `${base}/quick-links/${modal === "edit" && selected ? `${selected.id}/` : ""}`,
              modal === "edit" ? "PATCH" : "POST",
              { title: String(data.get("title") ?? ""), url }
            );
            await links.refresh();
            setModal(undefined);
          }}
        >
          <LabField label="名称">
            <input
              className={labInputClass}
              name="title"
              required
              maxLength={255}
              defaultValue={modal === "edit" ? String(selected?.title ?? "") : ""}
            />
          </LabField>
          <LabField label="链接">
            <input
              className={labInputClass}
              name="url"
              type="url"
              required
              defaultValue={modal === "edit" ? String(selected?.url ?? "") : ""}
              placeholder="https://"
            />
          </LabField>
        </LabDialog>
      )}
      {modal === "delete" && selected && (
        <LabDialog
          title="删除快捷链接"
          submitLabel="确认删除"
          destructive
          onClose={() => setModal(undefined)}
          onSubmit={async () => {
            await props.client.request(`${base}/quick-links/${selected.id}/`, "DELETE");
            await links.refresh();
            setModal(undefined);
          }}
        >
          <p>删除“{String(selected.title ?? selected.url)}”？</p>
        </LabDialog>
      )}
    </>
  );
}
function validUrl(value: unknown): boolean {
  try {
    return ["http:", "https:"].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}
