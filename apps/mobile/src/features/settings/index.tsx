// oxlint-disable-next-line import/no-unassigned-import -- mobile settings presentation
import "./settings.css";
import { useEffect, useMemo, useState } from "react";
import { CanonicalIcon } from "../../components/navigation";
import {
  ActionButton,
  ErrorMessage,
  FormSheet,
  Loading,
  PageHeading,
  Sheet,
  records,
  textValue,
  useData,
  type Entity,
  type FormField,
} from "../../components/ui";
import type { ApiClient } from "../../lib/client";
import { canManage, roleName, roleOptions, SettingsApi, stateOptions } from "./api";
import { SettingsImage } from "./assets";
import { ApiTokenSettings, PreferencesSettings, type ThemeChange } from "./preferences";
import { ProjectAutomations, ProjectEstimates, ProjectFeatures } from "./project-options";
import { WebhookSettings } from "./webhooks";

type Props = {
  section: "personal" | "workspace" | "project";
  workspaceSlug: string;
  projectId?: string;
  client: ApiClient;
  onServerChange: () => void;
  onLogout: () => void | Promise<void>;
  onWorkspaceChanged?: () => void | Promise<void>;
  onThemeChange?: ThemeChange;
};
type Editor = { title: string; fields: FormField[]; submit: (values: Record<string, string>) => Promise<unknown> };
type Confirmation = { title: string; action: () => Promise<unknown> };

function SettingsForms({
  editor,
  confirmation,
  close,
}: {
  editor?: Editor;
  confirmation?: Confirmation;
  close: () => void;
}) {
  return (
    <>
      {editor && <FormSheet title={editor.title} fields={editor.fields} onSubmit={editor.submit} onClose={close} />}
      {confirmation && (
        <Sheet title={confirmation.title} onClose={close}>
          <div className="actions">
            <button className="button" onClick={close}>
              取消
            </button>
            <ActionButton className="button danger" action={confirmation.action} onDone={close}>
              确认
            </ActionButton>
          </div>
        </Sheet>
      )}
    </>
  );
}

function PersonalSettings({
  client,
  onServerChange,
  onLogout,
  onThemeChange,
}: Pick<Props, "client" | "onServerChange" | "onLogout" | "onThemeChange">) {
  const profile = useData<Entity>(client, "/api/users/me/");
  const preferences = useData<Entity>(client, "/api/users/me/notification-preferences/");
  const [tab, setTab] = useState("profile");
  const [assets, setAssets] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [preferenceError, setPreferenceError] = useState<unknown>();
  const [saveError, setSaveError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const api = useMemo(() => new SettingsApi(client), [client]);
  const name = textValue(profile.data?.display_name ?? profile.data?.username);
  return (
    <>
      <PageHeading title="个人资料" />
      <main className="pm-body pm-profile">
        <div className="pm-profile-tabs" role="tablist" aria-label="个人设置页面">
          {[
            { id: "profile", name: "个人资料" },
            { id: "preferences", name: "偏好主题" },
            { id: "notifications", name: "通知" },
            { id: "tokens", name: "API令牌" },
            { id: "connection", name: "连接" },
          ].map((row) => (
            <button
              type="button"
              role="tab"
              aria-selected={row.id === tab}
              className={row.id === tab ? "pm-selected" : ""}
              key={row.id}
              onClick={() => setTab(row.id)}
            >
              {row.name}
            </button>
          ))}
        </div>
        <ErrorMessage error={profile.error} />
        {tab === "profile" &&
          (profile.loading ? (
            <Loading />
          ) : (
            profile.data && (
              <>
                <section className="pm-profile-identity">
                  <span className="pm-avatar">{name.slice(0, 1)}</span>
                  <div>
                    <h2>{name}</h2>
                    <p>{textValue(profile.data.email)}</p>
                  </div>
                  <button className="m3-icon-button pm-camera" aria-label="头像与封面" onClick={() => setAssets(true)}>
                    <CanonicalIcon name="camera" size={21} />
                  </button>
                </section>
                <form
                  className="pm-profile-fields"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (saving) return;
                    setSaving(true);
                    setSaveError(undefined);
                    setSaved(false);
                    const data = new FormData(event.currentTarget);
                    try {
                      await api.updatePersonal(
                        Object.fromEntries(
                          ["first_name", "last_name", "display_name"].map((key) => [
                            key,
                            String(data.get(key) ?? "").trim(),
                          ])
                        )
                      );
                      await profile.refresh();
                      setSaved(true);
                    } catch (error) {
                      setSaveError(error);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <h2>基本信息</h2>
                  <div className="pm-name-fields">
                    <label className="pm-filled-field">
                      <span>名字</span>
                      <input
                        type="text"
                        name="first_name"
                        aria-label="名字"
                        defaultValue={String(profile.data.first_name ?? "")}
                      />
                    </label>
                    <label className="pm-filled-field">
                      <span>姓氏</span>
                      <input
                        type="text"
                        name="last_name"
                        aria-label="姓氏"
                        defaultValue={String(profile.data.last_name ?? "")}
                      />
                    </label>
                  </div>
                  <label className="pm-filled-field pm-display-name">
                    <span>
                      显示名称 <b>*</b>
                    </span>
                    <input
                      type="text"
                      name="display_name"
                      aria-label="显示名称"
                      required
                      defaultValue={String(profile.data.display_name ?? "")}
                    />
                  </label>
                  <ErrorMessage error={saveError} />
                  {saved && (
                    <p className="muted" role="status">
                      已保存
                    </p>
                  )}
                  <div className="pm-profile-actions">
                    <button type="submit" className="m3-button pm-save" disabled={saving}>
                      {saving ? "正在保存…" : "保存"}
                    </button>
                    <button type="button" className="pm-avatar-change" onClick={() => setAssets(true)}>
                      <CanonicalIcon name="camera" size={17} />
                      更换头像
                    </button>
                  </div>
                  <button
                    type="button"
                    className="pm-deactivate"
                    onClick={() =>
                      setConfirmation({
                        title: "停用账号？",
                        action: async () => {
                          await client.request("/api/users/me/", "DELETE");
                          await onLogout();
                        },
                      })
                    }
                  >
                    停用账号
                  </button>
                </form>
              </>
            )
          ))}
        {tab === "preferences" && <PreferencesSettings client={client} onThemeChange={onThemeChange} />}
        {tab === "notifications" && (
          <>
            <h2 className="section-label">通知偏好</h2>
            <ErrorMessage error={preferences.error} />
            {preferences.loading && <Loading />}
            {preferences.data &&
              Object.entries(preferences.data)
                .filter(([, value]) => typeof value === "boolean")
                .map(([key, value]) => (
                  <label className="settings-switch-row" key={key}>
                    <span>{notificationLabels[key] ?? key}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={async (event) => {
                        try {
                          await client.request("/api/users/me/notification-preferences/", "PATCH", {
                            [key]: event.target.checked,
                          });
                          await preferences.refresh();
                        } catch (error) {
                          setPreferenceError(error);
                        }
                      }}
                    />
                  </label>
                ))}
            <ErrorMessage error={preferenceError} />
          </>
        )}
        {tab === "tokens" && <ApiTokenSettings client={client} />}
        {tab === "connection" && (
          <>
            <h2 className="section-label">服务器</h2>
            <p className="value">{client.server}</p>
            <button className="button" onClick={onServerChange}>
              切换服务器
            </button>
            <ActionButton action={async () => onLogout()}>退出登录</ActionButton>
          </>
        )}
      </main>
      {assets && (
        <Sheet title="头像与封面" onClose={() => setAssets(false)}>
          <SettingsImage
            client={client}
            title="头像"
            source={profile.data?.avatar_url}
            path="/api/assets/v2/user-assets/"
            entityType="USER_AVATAR"
            refresh={profile.refresh}
          />
          <SettingsImage
            client={client}
            title="封面"
            source={profile.data?.cover_image_url}
            path="/api/assets/v2/user-assets/"
            entityType="USER_COVER"
            refresh={profile.refresh}
          />
        </Sheet>
      )}
      <SettingsForms confirmation={confirmation} close={() => setConfirmation(undefined)} />
    </>
  );
}
const notificationLabels: Record<string, string> = {
  property_change: "任务属性变更",
  state_change: "状态变更",
  comment: "评论",
  mention: "提及",
  issue_completed: "任务完成",
  issue_due: "任务到期",
  issue_overdue: "任务逾期",
};

function WorkspaceSettings({
  client,
  workspaceSlug,
  onWorkspaceChanged,
}: Pick<Props, "client" | "workspaceSlug" | "onWorkspaceChanged">) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/`;
  const workspace = useData<Entity>(client, workspaceSlug ? base : null);
  const me = useData<Entity>(client, workspaceSlug ? `${base}workspace-members/me/` : null);
  const members = useData(client, workspaceSlug ? `${base}members/` : null);
  const manage = canManage(me.data?.role);
  const [tab, setTab] = useState("general");
  const [memberSearch, setMemberSearch] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const close = () => {
    setEditor(undefined);
    setConfirmation(undefined);
  };
  return (
    <>
      <PageHeading title="工作区设置" />
      <button
        className="button"
        onClick={() =>
          setEditor({
            title: "创建工作区",
            fields: [
              { key: "name", label: "名称", required: true },
              { key: "slug", label: "地址标识", required: true },
              { key: "organization_size", label: "组织人数" },
              { key: "timezone", label: "时区", value: Intl.DateTimeFormat().resolvedOptions().timeZone },
            ],
            submit: async (values) => {
              await client.request("/api/workspaces/", "POST", values);
              await onWorkspaceChanged?.();
            },
          })
        }
      >
        创建工作区
      </button>
      {!workspaceSlug && <p className="empty">请选择工作区</p>}
      <nav className="tabs">
        {[
          { key: "general", title: "基本信息" },
          { key: "members", title: "成员" },
          ...(manage ? [{ key: "webhooks", title: "Webhooks" }] : []),
        ].map((item) => (
          <button className={tab === item.key ? "active" : ""} key={item.key} onClick={() => setTab(item.key)}>
            {item.title}
          </button>
        ))}
      </nav>
      {tab === "general" &&
        (workspace.loading ? (
          <Loading />
        ) : (
          workspace.data && (
            <article className="card">
              <h2>{textValue(workspace.data.name)}</h2>
              <SettingsImage
                client={client}
                title="工作区图标"
                source={workspace.data.logo_url}
                path={`/api/assets/v2/workspaces/${encodeURIComponent(workspaceSlug)}/`}
                entityType="WORKSPACE_LOGO"
                identifier={workspace.data.id}
                refresh={workspace.refresh}
                editable={manage}
              />
              <dl className="record-fields">
                <div>
                  <dt>工作区地址</dt>
                  <dd>{textValue(workspace.data.slug)}</dd>
                </div>
                <div>
                  <dt>成员数</dt>
                  <dd>{textValue(workspace.data.total_members)}</dd>
                </div>
              </dl>
              <ActionButton action={() => navigator.clipboard.writeText(`${client.server}/${workspaceSlug}/`)}>
                复制地址
              </ActionButton>
              {manage && (
                <button
                  className="button"
                  onClick={() =>
                    setEditor({
                      title: "编辑工作区",
                      fields: [
                        { key: "name", label: "名称", value: workspace.data?.name, required: true },
                        { key: "organization_size", label: "组织人数", value: workspace.data?.organization_size },
                        { key: "timezone", label: "时区", value: workspace.data?.timezone ?? "UTC" },
                      ],
                      submit: async (values) => {
                        await client.request(base, "PATCH", values);
                        await workspace.refresh();
                      },
                    })
                  }
                >
                  编辑
                </button>
              )}
              {manage && (
                <button
                  className="button danger"
                  onClick={() =>
                    setEditor({
                      title: "删除工作区",
                      fields: [
                        { key: "name", label: `输入工作区名称：${textValue(workspace.data?.name)}`, required: true },
                        { key: "confirmation", label: "输入确认短语：delete my workspace", required: true },
                      ],
                      submit: async (values) => {
                        if (values.name !== workspace.data?.name) throw new Error("工作区名称不匹配");
                        if (values.confirmation !== "delete my workspace") throw new Error("确认短语不匹配");
                        await client.request(base, "DELETE");
                        await onWorkspaceChanged?.();
                      },
                    })
                  }
                >
                  删除工作区
                </button>
              )}
            </article>
          )
        ))}
      {tab === "members" && (
        <>
          <label className="field">
            <span>搜索成员</span>
            <input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
          </label>
          <div className="list">
            {records(members.data)
              .filter((member) =>
                `${textValue(member.member)} ${textValue((member.member as Entity)?.email)}`
                  .toLowerCase()
                  .includes(memberSearch.toLowerCase())
              )
              .map((member) => (
                <article className="card" key={member.id}>
                  <h3>{textValue(member.member)}</h3>
                  <p>{roleName(member.role)}</p>
                  {manage && (
                    <div className="actions">
                      <button
                        className="button"
                        onClick={() =>
                          setEditor({
                            title: "修改成员角色",
                            fields: [
                              {
                                key: "role",
                                label: "角色",
                                type: "select",
                                options: roleOptions,
                                value: member.role,
                                required: true,
                              },
                            ],
                            submit: async (values) => {
                              await client.request(`${base}members/${member.id}/`, "PATCH", {
                                role: Number(values.role),
                              });
                              await members.refresh();
                            },
                          })
                        }
                      >
                        修改角色
                      </button>
                      <button
                        className="button danger"
                        onClick={() =>
                          setConfirmation({
                            title: `移除 ${textValue(member.member)}？`,
                            action: async () => {
                              await client.request(`${base}members/${member.id}/`, "DELETE");
                              await members.refresh();
                            },
                          })
                        }
                      >
                        移除
                      </button>
                    </div>
                  )}
                </article>
              ))}
          </div>
          <ErrorMessage error={members.error} />
        </>
      )}
      {tab === "webhooks" && manage && <WebhookSettings client={client} workspaceSlug={workspaceSlug} />}
      <ErrorMessage error={workspace.error ?? me.error} />
      <SettingsForms editor={editor} confirmation={confirmation} close={close} />
    </>
  );
}

function ProjectSettings({ client, workspaceSlug, projectId }: Pick<Props, "client" | "workspaceSlug" | "projectId">) {
  const projects = useData(client, workspaceSlug ? `/api/workspaces/${workspaceSlug}/projects/` : null);
  const [chosen, setChosen] = useState(projectId ?? "");
  useEffect(() => {
    if (projectId) setChosen(projectId);
  }, [projectId]);
  const base = `/api/workspaces/${workspaceSlug}/projects/${chosen}/`;
  const project = useData<Entity>(client, chosen ? base : null);
  const me = useData<Entity>(client, chosen ? `${base}project-members/me/` : null);
  const members = useData(client, chosen ? `${base}members/` : null);
  const workspaceMembers = useData(client, workspaceSlug ? `/api/workspaces/${workspaceSlug}/members/` : null);
  const states = useData(client, chosen ? `${base}states/` : null);
  const labels = useData(client, chosen ? `${base}issue-labels/` : null);
  const [tab, setTab] = useState("general");
  const [memberSearch, setMemberSearch] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const manage = canManage(me.data?.role);
  const api = useMemo(() => new SettingsApi(client), [client]);
  const close = () => {
    setEditor(undefined);
    setConfirmation(undefined);
  };
  const collection = tab === "states" ? states : labels;
  const endpoint = tab === "states" ? "states" : "issue-labels";
  const editEntity = (entity?: Entity) =>
    setEditor({
      title: `${entity ? "编辑" : "新增"}${tab === "states" ? "状态" : "标签"}`,
      fields: [
        { key: "name", label: "名称", required: true, value: entity?.name },
        { key: "color", label: "颜色", value: entity?.color ?? "#2668ea", required: true },
        { key: "description", label: "描述", value: entity?.description, type: "textarea" },
        ...(tab === "states"
          ? [
              {
                key: "group",
                label: "状态分组",
                type: "select" as const,
                options: stateOptions,
                value: entity?.group ?? "unstarted",
                required: true,
              },
            ]
          : [
              {
                key: "parent",
                label: "父标签",
                type: "select" as const,
                value: entity?.parent ?? "",
                options: [
                  { value: "", label: "无" },
                  ...records(labels.data)
                    .filter((label) => label.id !== entity?.id)
                    .map((label) => ({ value: String(label.id), label: textValue(label.name) })),
                ],
              },
            ]),
      ],
      submit: async (values) => {
        await client.request(
          `${base}${endpoint}/${entity ? `${entity.id}/` : ""}`,
          entity ? "PATCH" : "POST",
          tab === "labels" ? { ...values, parent: values.parent || null } : values
        );
        await collection.refresh();
      },
    });
  return (
    <>
      <PageHeading title="项目设置" />
      <label className="field">
        <span>项目</span>
        <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
          <option value="">请选择项目</option>
          {records(projects.data).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <>
          <nav className="tabs">
            {[
              { key: "general", title: "基本信息" },
              { key: "members", title: "成员" },
              { key: "states", title: "状态" },
              { key: "labels", title: "标签" },
              { key: "estimates", title: "估点" },
              { key: "features", title: "功能" },
              { key: "automations", title: "自动化" },
            ].map((item) => (
              <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
                {item.title}
              </button>
            ))}
          </nav>
          {tab === "general" && project.data && (
            <article className="card">
              <h2>{textValue(project.data.name)}</h2>
              <p>{textValue(project.data.identifier)}</p>
              <p>{textValue(project.data.description)}</p>
              <SettingsImage
                client={client}
                title="项目封面"
                source={project.data.cover_image_url}
                path={`/api/assets/v2/workspaces/${encodeURIComponent(workspaceSlug)}/`}
                entityType="PROJECT_COVER"
                identifier={chosen}
                refresh={project.refresh}
                editable={manage}
              />
              {manage && (
                <button
                  className="button"
                  onClick={() =>
                    setEditor({
                      title: "编辑项目",
                      fields: [
                        { key: "name", label: "名称", value: project.data?.name, required: true },
                        { key: "identifier", label: "标识", value: project.data?.identifier, required: true },
                        { key: "description", label: "描述", value: project.data?.description, type: "textarea" },
                        ...["project_lead", "default_assignee"].map((key) => ({
                          key,
                          label: key === "project_lead" ? "项目负责人" : "默认执行人",
                          type: "select" as const,
                          value:
                            typeof project.data?.[key] === "object" && project.data?.[key]
                              ? (project.data[key] as Entity).id
                              : (project.data?.[key] ?? ""),
                          options: [
                            { value: "", label: "无" },
                            ...records(members.data).map((member) => ({
                              value: String((member.member as Entity)?.id ?? ""),
                              label: textValue(member.member),
                            })),
                          ],
                        })),
                        {
                          key: "network",
                          label: "可见性",
                          type: "select",
                          value: project.data?.network,
                          options: [
                            { value: "0", label: "私有" },
                            { value: "2", label: "公开" },
                          ],
                        },
                      ],
                      submit: async (values) => {
                        await client.request(base, "PATCH", {
                          ...values,
                          network: Number(values.network),
                          project_lead: values.project_lead || null,
                          default_assignee: values.default_assignee || null,
                        });
                        await project.refresh();
                      },
                    })
                  }
                >
                  编辑项目
                </button>
              )}
              {manage && (
                <div className="actions">
                  <button
                    className="button"
                    onClick={() =>
                      setConfirmation({
                        title: project.data?.archived_at ? "恢复项目？" : "归档项目？",
                        action: async () => {
                          await client.request(`${base}archive/`, project.data?.archived_at ? "DELETE" : "POST", {});
                          await project.refresh();
                          await projects.refresh();
                        },
                      })
                    }
                  >
                    {project.data.archived_at ? "恢复项目" : "归档项目"}
                  </button>
                  <button
                    className="button danger"
                    onClick={() =>
                      setEditor({
                        title: "删除项目",
                        fields: [
                          { key: "name", label: `输入项目名称：${textValue(project.data?.name)}`, required: true },
                          { key: "confirmation", label: "输入确认短语：delete my project", required: true },
                        ],
                        submit: async (values) => {
                          if (values.name !== project.data?.name) throw new Error("项目名称不匹配");
                          if (values.confirmation !== "delete my project") throw new Error("确认短语不匹配");
                          await client.request(base, "DELETE");
                          setChosen("");
                          await projects.refresh();
                        },
                      })
                    }
                  >
                    删除项目
                  </button>
                </div>
              )}
            </article>
          )}
          {tab === "members" && (
            <>
              <label className="field">
                <span>搜索成员</span>
                <input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
              </label>
              {manage && (
                <button
                  className="button primary"
                  onClick={() =>
                    setEditor({
                      title: "添加项目成员",
                      fields: [
                        {
                          key: "member_id",
                          label: "工作区成员",
                          type: "select",
                          required: true,
                          options: records(workspaceMembers.data).map((member) => ({
                            value: String((member.member as Entity)?.id ?? ""),
                            label: textValue(member.member),
                          })),
                        },
                        {
                          key: "role",
                          label: "角色",
                          type: "select",
                          value: "15",
                          options: roleOptions,
                          required: true,
                        },
                      ],
                      submit: async (values) => {
                        await api.addProjectMember(workspaceSlug, chosen, values.member_id, values.role);
                        await members.refresh();
                      },
                    })
                  }
                >
                  添加成员
                </button>
              )}
              <div className="list">
                {records(members.data)
                  .filter((member) =>
                    `${textValue(member.member)} ${textValue((member.member as Entity)?.email)}`
                      .toLowerCase()
                      .includes(memberSearch.toLowerCase())
                  )
                  .map((member) => (
                    <article className="card" key={member.id}>
                      <h3>{textValue(member.member)}</h3>
                      <p>{roleName(member.role)}</p>
                      {manage && (
                        <div className="actions">
                          <button
                            className="button"
                            onClick={() =>
                              setEditor({
                                title: "修改项目角色",
                                fields: [
                                  {
                                    key: "role",
                                    label: "角色",
                                    type: "select",
                                    value: member.role,
                                    options: roleOptions,
                                  },
                                ],
                                submit: async (values) => {
                                  await client.request(`${base}members/${member.id}/`, "PATCH", {
                                    role: Number(values.role),
                                  });
                                  await members.refresh();
                                },
                              })
                            }
                          >
                            修改角色
                          </button>
                          <button
                            className="button danger"
                            onClick={() =>
                              setConfirmation({
                                title: "移除项目成员？",
                                action: async () => {
                                  await client.request(`${base}members/${member.id}/`, "DELETE");
                                  await members.refresh();
                                },
                              })
                            }
                          >
                            移除
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
              </div>
            </>
          )}
          {project.data && tab === "features" && (
            <ProjectFeatures
              client={client}
              base={base}
              project={project.data}
              refresh={project.refresh}
              manage={manage}
            />
          )}
          {project.data && tab === "automations" && (
            <ProjectAutomations
              client={client}
              base={base}
              project={project.data}
              refresh={project.refresh}
              manage={manage}
            />
          )}
          {project.data && tab === "estimates" && (
            <ProjectEstimates
              client={client}
              base={base}
              project={project.data}
              refresh={project.refresh}
              manage={manage}
            />
          )}
          {(tab === "states" || tab === "labels") && (
            <>
              {manage && (
                <button className="button primary" onClick={() => editEntity()}>
                  新增{tab === "states" ? "状态" : "标签"}
                </button>
              )}
              <div className="list">
                {records(collection.data).map((item) => (
                  <article className="card" key={item.id}>
                    <h3>
                      <span className="color-dot" style={{ background: String(item.color ?? "#2668ea") }} />
                      {item.name}
                    </h3>
                    {item.group ? <p>{stateOptions.find((option) => option.value === item.group)?.label}</p> : null}
                    {manage && (
                      <div className="actions">
                        <button className="button" onClick={() => editEntity(item)}>
                          编辑
                        </button>
                        {tab === "states" && !item.default && (
                          <ActionButton
                            action={() => client.request(`${base}states/${item.id}/mark-default/`, "POST", {})}
                            onDone={() => {
                              void states.refresh();
                            }}
                          >
                            设为默认
                          </ActionButton>
                        )}
                        <button
                          className="button danger"
                          onClick={() =>
                            setConfirmation({
                              title: "删除记录？",
                              action: async () => {
                                await client.request(`${base}${endpoint}/${item.id}/`, "DELETE");
                                await collection.refresh();
                              },
                            })
                          }
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <ErrorMessage error={collection.error} />
            </>
          )}
        </>
      )}
      <ErrorMessage error={projects.error ?? project.error ?? me.error ?? members.error} />
      <SettingsForms editor={editor} confirmation={confirmation} close={close} />
    </>
  );
}

export function SettingsFeature(props: Props) {
  if (props.section === "personal") return <PersonalSettings {...props} />;
  if (props.section === "workspace") return <WorkspaceSettings {...props} />;
  if (props.section === "project") return <ProjectSettings {...props} />;
  return null;
}
