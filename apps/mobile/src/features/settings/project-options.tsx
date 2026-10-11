import { MobileSelect } from "../../components/select";
import { useState } from "react";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Sheet,
  records,
  textValue,
  useData,
  type Entity,
  type FormField,
} from "../../components/ui";
import type { ApiClient } from "../../lib/client";
import { SettingsApi } from "./api";

const features = [
  { key: "cycle_view", label: "周期" },
  { key: "module_view", label: "模块" },
  { key: "issue_views_view", label: "视图" },
  { key: "page_view", label: "文档" },
  { key: "intake_view", label: "收件箱" },
];
export function ProjectFeatures({
  client,
  base,
  project,
  refresh,
  manage,
}: {
  client: ApiClient;
  base: string;
  project: Entity;
  refresh: () => Promise<unknown>;
  manage: boolean;
}) {
  const [error, setError] = useState<unknown>();
  return (
    <article className="card">
      <h2>项目功能</h2>
      {features.map((feature) => (
        <label className="field" key={feature.key}>
          <span>{feature.label}</span>
          <input
            type="checkbox"
            disabled={!manage}
            checked={Boolean(project[feature.key])}
            onChange={async (event) => {
              try {
                await new SettingsApi(client).updateProjectFeature(base, feature.key, event.target.checked);
                await refresh();
              } catch (err) {
                setError(err);
              }
            }}
          />
        </label>
      ))}
      <ErrorMessage error={error} />
    </article>
  );
}

export function ProjectAutomations({
  client,
  base,
  project,
  refresh,
  manage,
}: {
  client: ApiClient;
  base: string;
  project: Entity;
  refresh: () => Promise<unknown>;
  manage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const options = [
    { value: "0", label: "关闭" },
    ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 个月` })),
  ];
  return (
    <article className="card">
      <h2>自动化</h2>
      <dl className="record-fields">
        <div>
          <dt>自动归档已完成任务</dt>
          <dd>{Number(project.archive_in) ? `${project.archive_in} 个月` : "关闭"}</dd>
        </div>
        <div>
          <dt>自动关闭长期未更新任务</dt>
          <dd>{Number(project.close_in) ? `${project.close_in} 个月` : "关闭"}</dd>
        </div>
      </dl>
      {manage && (
        <button className="button" onClick={() => setEditing(true)}>
          编辑自动化
        </button>
      )}
      {editing && (
        <FormSheet
          title="项目自动化"
          fields={[
            { key: "archive_in", label: "归档等待时间", type: "select", options, value: project.archive_in ?? 0 },
            { key: "close_in", label: "关闭等待时间", type: "select", options, value: project.close_in ?? 0 },
          ]}
          onClose={() => setEditing(false)}
          onSubmit={async (values) => {
            await client.request(base, "PATCH", {
              archive_in: Number(values.archive_in),
              close_in: Number(values.close_in),
            });
            await refresh();
          }}
        />
      )}
    </article>
  );
}

type Editor = { title: string; fields: FormField[]; submit: (values: Record<string, string>) => Promise<unknown> };
export function ProjectEstimates({
  client,
  base,
  project,
  refresh,
  manage,
}: {
  client: ApiClient;
  base: string;
  project: Entity;
  refresh: () => Promise<unknown>;
  manage: boolean;
}) {
  const estimates = useData(client, `${base}estimates/`);
  const [editor, setEditor] = useState<Editor>();
  const [deleting, setDeleting] = useState<{ name: string; action: () => Promise<unknown> }>();
  const [error, setError] = useState<unknown>();
  const editPoint = (estimate: Entity, point?: Entity) =>
    setEditor({
      title: point ? "编辑估点" : "添加估点",
      fields: [
        {
          key: "key",
          label: "顺序（从 1 开始）",
          type: "number",
          value: point?.key ?? records(estimate.points).length + 1,
          required: true,
        },
        { key: "value", label: "估点值", value: point?.value, required: true },
        { key: "description", label: "描述", type: "textarea", value: point?.description },
      ],
      submit: async (values) => {
        const key = Number(values.key);
        if (!Number.isInteger(key) || key < 1) throw new Error("顺序必须是正整数");
        if (values.value.length > 20) throw new Error("估点值最多 20 个字符");
        await client.request(
          `${base}estimates/${estimate.id}/estimate-points/${point ? `${point.id}/` : ""}`,
          point ? "PATCH" : "POST",
          { ...values, key }
        );
        await estimates.refresh();
      },
    });
  return (
    <>
      <article className="card">
        <h2>估点方案</h2>
        <label className="field">
          <span>当前方案</span>
          <MobileSelect
            disabled={!manage}
            value={
              typeof project.estimate === "object" && project.estimate
                ? String((project.estimate as Entity).id)
                : String(project.estimate ?? "")
            }
            onChange={async (event) => {
              try {
                await client.request(base, "PATCH", { estimate: event.target.value || null });
                await refresh();
              } catch (err) {
                setError(err);
              }
            }}
          >
            <option value="">不使用估点</option>
            {records(estimates.data).map((estimate) => (
              <option key={estimate.id} value={estimate.id}>
                {estimate.name}
              </option>
            ))}
          </MobileSelect>
        </label>
        {manage && (
          <button
            className="button primary"
            onClick={() =>
              setEditor({
                title: "创建估点方案",
                fields: [
                  { key: "name", label: "名称", required: true },
                  {
                    key: "type",
                    label: "类型",
                    type: "select",
                    options: [
                      { value: "points", label: "数字" },
                      { value: "categories", label: "分类" },
                    ],
                    value: "points",
                    required: true,
                  },
                  {
                    key: "points",
                    label: "估点（每行一个）",
                    type: "textarea",
                    value: "1\n2\n3\n5\n8",
                    required: true,
                  },
                ],
                submit: async (values) => {
                  const points = values.points
                    .split(/\r?\n/)
                    .map((v) => v.trim())
                    .filter(Boolean);
                  if (!points.length || new Set(points).size !== points.length) throw new Error("请填写不重复的估点值");
                  if (points.some((value) => value.length > 20)) throw new Error("每个估点值最多 20 个字符");
                  await client.request(`${base}estimates/`, "POST", {
                    estimate: { name: values.name, type: values.type },
                    estimate_points: points.map((value, index) => ({ key: index + 1, value })),
                  });
                  await estimates.refresh();
                },
              })
            }
          >
            创建方案
          </button>
        )}
        <ErrorMessage error={error ?? estimates.error} />
      </article>
      {records(estimates.data).map((estimate) => (
        <article className="card" key={estimate.id}>
          <h3>{textValue(estimate.name)}</h3>
          <p>{estimate.type === "points" ? "数字" : "分类"}</p>
          {records(estimate.points).map((point) => (
            <div className="record-fields" key={point.id}>
              <span>
                {textValue(point.key)} · {textValue(point.value)}
              </span>
              {manage && (
                <div className="actions">
                  <button className="button" onClick={() => editPoint(estimate, point)}>
                    编辑
                  </button>
                  <button
                    className="button danger"
                    onClick={() =>
                      setDeleting({
                        name: "估点",
                        action: async () => {
                          await client.request(
                            `${base}estimates/${estimate.id}/estimate-points/${point.id}/`,
                            "DELETE"
                          );
                          await estimates.refresh();
                        },
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
          {manage && (
            <div className="actions">
              <button className="button" onClick={() => editPoint(estimate)}>
                添加估点
              </button>
              <button
                className="button"
                onClick={() =>
                  setEditor({
                    title: "编辑估点方案",
                    fields: [{ key: "name", label: "名称", value: estimate.name, required: true }],
                    submit: async (values) => {
                      if (!records(estimate.points).length) throw new Error("请先添加至少一个估点");
                      await client.request(`${base}estimates/${estimate.id}/`, "PATCH", {
                        estimate: { name: values.name },
                        estimate_points: records(estimate.points),
                      });
                      await estimates.refresh();
                    },
                  })
                }
              >
                重命名
              </button>
              <button
                className="button danger"
                onClick={() =>
                  setDeleting({
                    name: "估点方案",
                    action: async () => {
                      await client.request(`${base}estimates/${estimate.id}/`, "DELETE");
                      await estimates.refresh();
                      await refresh();
                    },
                  })
                }
              >
                删除方案
              </button>
            </div>
          )}
        </article>
      ))}
      {editor && (
        <FormSheet
          title={editor.title}
          fields={editor.fields}
          onSubmit={editor.submit}
          onClose={() => setEditor(undefined)}
        />
      )}
      {deleting && (
        <Sheet title={`删除${deleting.name}？`} onClose={() => setDeleting(undefined)}>
          <ActionButton className="button danger" action={deleting.action} onDone={() => setDeleting(undefined)}>
            确认删除
          </ActionButton>
        </Sheet>
      )}
    </>
  );
}
