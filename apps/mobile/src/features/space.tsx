import { useState } from "react";
import type { ApiClient } from "../lib/client";
import { spaceIssueProperties } from "./space-issue";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Html,
  Loading,
  PageHeading,
  RecordList,
  records,
  textValue,
  useData,
  type Entity,
} from "../components/ui";

export function parseAnchor(input: string): string {
  const value = input.trim();
  if (!value.includes("://")) {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("共享标识无效");
    return value;
  }
  const url = new URL(value);
  const segments = url.pathname.split("/").filter(Boolean);
  const index = segments.indexOf("anchor");
  const anchor =
    index >= 0 ? segments[index + 1] : (segments.find((_, i) => segments[i - 1] === "spaces") ?? segments[0]);
  if (!anchor || !/^[a-zA-Z0-9_-]+$/.test(anchor)) throw new Error("共享链接无效");
  return anchor;
}
export default function Space({ client }: { client: ApiClient }) {
  const [input, setInput] = useState("");
  const [anchor, setAnchor] = useState("");
  const [error, setError] = useState<unknown>();
  const [issueId, setIssueId] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [editingComment, setEditingComment] = useState<Entity>();
  const session = useData<Entity>(client, "/api/lab/session/");
  const userId = (session.data?.user as Entity | undefined)?.id;
  const [form, setForm] = useState<"comment" | "intake" | null>(null);
  const prefix = `/api/public/anchor/${anchor}/`;
  const metadata = useData<Entity>(client, anchor ? `${prefix}meta/` : null);
  const settings = useData<Entity>(client, anchor ? `${prefix}settings/` : null);
  const states = useData<Entity[]>(client, anchor ? `${prefix}states/` : null);
  const members = useData<Entity[]>(client, anchor ? `${prefix}members/` : null);
  const labels = useData<Entity[]>(client, anchor ? `${prefix}labels/` : null);
  const referenceData = { states: records(states.data), members: records(members.data), labels: records(labels.data) };
  const metadataLoading = metadata.loading || states.loading || members.loading || labels.loading;
  const issues = useData<Entity>(
    client,
    anchor && !issueId
      ? `${prefix}issues/?search=${encodeURIComponent(search)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      : null
  );
  const issue = useData<Entity>(client, anchor && issueId ? `${prefix}issues/${issueId}/` : null);
  const comments = useData(
    client,
    anchor && issueId && settings.data?.is_comments_enabled ? `${prefix}issues/${issueId}/comments/` : null
  );
  const openComment = () => setForm("comment");
  return (
    <>
      <PageHeading
        title={String(metadata.data?.name ?? "Space 共享页面")}
        onBack={issueId ? () => setIssueId("") : undefined}
      />
      <form
        className="search-field"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            setAnchor(parseAnchor(input));
            setIssueId("");
            setCursor("");
            setError(undefined);
          } catch (err) {
            setError(err);
          }
        }}
      >
        <input
          aria-label="共享链接或标识"
          placeholder="共享链接或标识"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="text-button" type="submit">
          打开
        </button>
      </form>
      <ErrorMessage
        error={
          error ??
          metadata.error ??
          settings.error ??
          states.error ??
          members.error ??
          labels.error ??
          issues.error ??
          issue.error
        }
      />
      {anchor && !issueId && (
        <>
          <label className="field">
            <span>搜索工作项</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor("");
              }}
            />
          </label>
          {settings.data?.intake && (
            <button className="button" onClick={() => setForm("intake")}>
              提交工作项
            </button>
          )}
          {issues.loading || metadataLoading ? (
            <Loading />
          ) : (
            <RecordList
              data={records(issues.data).map((row) =>
                Object.assign(
                  { id: row.id, name: row.name, 编号: row.sequence_id },
                  Object.fromEntries(spaceIssueProperties(row, referenceData))
                )
              )}
              fields={["编号", "状态", "优先级", "负责人", "标签", "开始日期", "截止日期"]}
              onOpen={(item) => setIssueId(String(item.id))}
            />
          )}
          <div className="actions">
            {issues.data?.prev_cursor ? (
              <button className="button" onClick={() => setCursor(String(issues.data?.prev_cursor))}>
                上一页
              </button>
            ) : null}
            {issues.data?.next_page_results && issues.data?.next_cursor ? (
              <button className="button" onClick={() => setCursor(String(issues.data?.next_cursor))}>
                下一页
              </button>
            ) : null}
          </div>
        </>
      )}
      {issueId &&
        (issue.loading || metadataLoading ? (
          <Loading />
        ) : (
          <>
            <p className="muted">
              {String(metadata.data?.identifier ?? "")} {textValue(issue.data?.sequence_id)}
            </p>
            <h1>{textValue(issue.data?.name)}</h1>
            <Html html={issue.data?.description_html} />
            <dl className="record-fields">
              {spaceIssueProperties(issue.data ?? {}, referenceData).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {settings.data?.is_votes_enabled && (
              <ActionButton
                action={() =>
                  client.request(
                    `${prefix}issues/${issueId}/votes/`,
                    records(issue.data?.vote_items).some((vote) => (vote.actor_details as Entity)?.id === userId)
                      ? "DELETE"
                      : "POST"
                  )
                }
                onDone={() => {
                  void issue.refresh();
                }}
              >
                {records(issue.data?.vote_items).some((vote) => (vote.actor_details as Entity)?.id === userId)
                  ? "取消投票"
                  : "投票"}
              </ActionButton>
            )}
            {settings.data?.is_reactions_enabled && (
              <div className="actions">
                {["1f44d", "1f389", "2764-fe0f"].map((reaction, i) => (
                  <ActionButton
                    key={reaction}
                    action={() => {
                      const active = records(issue.data?.reaction_items).some(
                        (item) => item.reaction === reaction && (item.actor_details as Entity)?.id === userId
                      );
                      return client.request(
                        `${prefix}issues/${issueId}/reactions/${active ? `${reaction}/` : ""}`,
                        active ? "DELETE" : "POST",
                        active ? undefined : { reaction }
                      );
                    }}
                    onDone={() => {
                      void issue.refresh();
                    }}
                  >
                    {["👍", "🎉", "❤️"][i]}
                  </ActionButton>
                ))}
              </div>
            )}
            {records(issue.data?.attachments ?? issue.data?.issue_attachments).map((file) => (
              <ActionButton
                key={file.id}
                action={() =>
                  client.download(
                    String(file.asset_url ?? `/api/public/assets/v2/anchor/${anchor}/${file.id}/`),
                    textValue(file.name)
                  )
                }
              >
                {textValue(file.name)}
              </ActionButton>
            ))}
            {settings.data?.is_comments_enabled && (
              <>
                <h2 className="section-label">评论</h2>
                <ErrorMessage error={comments.error} />
                {records(comments.data).map((comment) => (
                  <article className="card" key={comment.id}>
                    <p className="muted">
                      {textValue(comment.actor_detail ?? comment.actor)} · {textValue(comment.created_at)}
                    </p>
                    <Html html={comment.comment_html} />
                    {userId && String(comment.actor ?? (comment.actor_detail as Entity)?.id) === userId && (
                      <div className="actions">
                        <button className="button" onClick={() => setEditingComment(comment)}>
                          编辑评论
                        </button>
                        <ActionButton
                          className="button danger"
                          action={async () => {
                            if (window.confirm("删除此评论？")) {
                              await client.request(`${prefix}issues/${issueId}/comments/${comment.id}/`, "DELETE");
                              await comments.refresh();
                            }
                          }}
                        >
                          删除评论
                        </ActionButton>
                      </div>
                    )}
                  </article>
                ))}
                <button className="button" onClick={openComment}>
                  添加评论
                </button>
              </>
            )}
          </>
        ))}
      {editingComment && (
        <FormSheet
          title="编辑评论"
          fields={[
            { key: "comment_html", label: "评论", type: "rich", required: true, value: editingComment.comment_html },
          ]}
          onClose={() => setEditingComment(undefined)}
          onSubmit={async (values) => {
            await client.request(`${prefix}issues/${issueId}/comments/${editingComment.id}/`, "PATCH", values);
            await comments.refresh();
          }}
        />
      )}
      {form && (
        <FormSheet
          title={form === "comment" ? "添加评论" : "提交工作项"}
          fields={
            form === "comment"
              ? [{ key: "text", label: "评论", type: "rich", required: true }]
              : [
                  { key: "name", label: "标题", required: true },
                  { key: "text", label: "描述", type: "textarea" },
                ]
          }
          onClose={() => setForm(null)}
          onSubmit={async (values) => {
            const html =
              form === "comment"
                ? values.text
                : `<p>${values.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>")}</p>`;
            if (form === "comment") {
              await client.request(`${prefix}issues/${issueId}/comments/`, "POST", {
                comment_html: html,
                access: "EXTERNAL",
              });
              await comments.refresh();
            } else {
              const intake = String(settings.data?.intake ?? settings.data?.intake_id ?? "");
              if (!intake) throw new Error("此共享项目未开启收件箱");
              await client.request(`${prefix}intakes/${intake}/intake-issues/`, "POST", {
                issue: { name: values.name, description_html: html },
              });
              await issues.refresh();
            }
          }}
        />
      )}
    </>
  );
}
