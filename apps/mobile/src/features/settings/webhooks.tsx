import { useState } from "react";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  RecordList,
  Sheet,
  records,
  textValue,
  useData,
  type Entity,
} from "../../components/ui";
import type { ApiClient } from "../../lib/client";

const events = [
  { key: "project", label: "项目" },
  { key: "issue", label: "任务" },
  { key: "issue_comment", label: "评论" },
  { key: "cycle", label: "周期" },
  { key: "module", label: "模块" },
];
const toggle = [
  { value: "true", label: "开启" },
  { value: "false", label: "关闭" },
];
export function WebhookSettings({ client, workspaceSlug }: { client: ApiClient; workspaceSlug: string }) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/webhooks/`;
  const hooks = useData(client, base);
  const [editor, setEditor] = useState<Entity | null>();
  const [deleting, setDeleting] = useState<Entity>();
  const [logsFor, setLogsFor] = useState<Entity>();
  const [secret, setSecret] = useState<string>();
  const logs = useData(
    client,
    logsFor ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/webhook-logs/${logsFor.id}/` : null
  );
  return (
    <>
      <button className="button primary" onClick={() => setEditor(null)}>
        创建 Webhook
      </button>
      <div className="list">
        {records(hooks.data).map((hook) => (
          <article className="card" key={hook.id}>
            <h3 className="value">{textValue(hook.url)}</h3>
            <p>
              {hook.is_active ? "启用" : "停用"} ·{" "}
              {events
                .filter((event) => hook[event.key])
                .map((event) => event.label)
                .join("、")}
            </p>
            <div className="actions">
              <button className="button" onClick={() => setEditor(hook)}>
                编辑
              </button>
              <button className="button" onClick={() => setLogsFor(hook)}>
                投递记录
              </button>
              <ActionButton
                action={async () => {
                  const data = await client.request<Entity>(`${base}${hook.id}/regenerate/`, "POST", {});
                  setSecret(String(data.secret_key));
                }}
              >
                重新生成签名密钥
              </ActionButton>
              <button className="button danger" onClick={() => setDeleting(hook)}>
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
      <ErrorMessage error={hooks.error} />
      {editor !== undefined && (
        <FormSheet
          title={editor ? "编辑 Webhook" : "创建 Webhook"}
          fields={[
            { key: "url", label: "接收地址", type: "url", required: true, value: editor?.url },
            { key: "is_active", label: "状态", type: "select", options: toggle, value: editor?.is_active ?? true },
            ...events.map((event) => ({
              ...event,
              type: "select" as const,
              options: toggle,
              value: editor?.[event.key] ?? false,
            })),
          ]}
          onClose={() => setEditor(undefined)}
          onSubmit={async (values) => {
            const data = await client.request<Entity>(
              `${base}${editor ? `${editor.id}/` : ""}`,
              editor ? "PATCH" : "POST",
              {
                url: values.url,
                ...Object.fromEntries(
                  ["is_active", ...events.map((event) => event.key)].map((key) => [key, values[key] === "true"])
                ),
              }
            );
            if (!editor && data.secret_key) setSecret(String(data.secret_key));
            await hooks.refresh();
          }}
        />
      )}
      {deleting && (
        <Sheet title="删除 Webhook？" onClose={() => setDeleting(undefined)}>
          <ActionButton
            className="button danger"
            action={async () => {
              await client.request(`${base}${deleting.id}/`, "DELETE");
              await hooks.refresh();
            }}
            onDone={() => setDeleting(undefined)}
          >
            确认删除
          </ActionButton>
        </Sheet>
      )}
      {logsFor && (
        <Sheet title="Webhook 投递记录" onClose={() => setLogsFor(undefined)}>
          <RecordList
            data={logs.data}
            fields={["status", "status_code", "created_at", "request_method", "response_body"]}
          />
          <ErrorMessage error={logs.error} />
        </Sheet>
      )}
      {secret && (
        <Sheet title="Webhook 签名密钥" onClose={() => setSecret(undefined)}>
          <p className="value" style={{ overflowWrap: "anywhere", userSelect: "text" }}>
            {secret}
          </p>
          <ActionButton action={() => navigator.clipboard.writeText(secret)}>复制密钥</ActionButton>
        </Sheet>
      )}
    </>
  );
}
