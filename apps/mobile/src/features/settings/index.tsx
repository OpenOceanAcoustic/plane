import { useEffect, useMemo, useState } from "react";
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
import { ApiClient } from "../../lib/client";
import { canManage, roleName, roleOptions, SettingsApi, stateOptions } from "./api";
import { SettingsImage } from "./assets";
import { ApiTokenSettings, PreferencesSettings, type ThemeChange } from "./preferences";
import { ProjectAutomations, ProjectEstimates, ProjectFeatures } from "./project-options";
import { WebhookSettings } from "./webhooks";
import { AdminReauthentication } from "./admin-reauthentication";

type Props = {
  section: "personal" | "workspace" | "project" | "admin";
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
  const [editor, setEditor] = useState<Editor>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [preferenceError, setPreferenceError] = useState<unknown>();
  const api = useMemo(() => new SettingsApi(client), [client]);
  const fields: FormField[] = [
    { key: "display_name", label: "显示名称", required: true },
    { key: "first_name", label: "名" },
    { key: "last_name", label: "姓" },
    { key: "user_timezone", label: "时区", placeholder: "Asia/Shanghai" },
  ];
  return (
    <>
      <PageHeading title="个人设置" />
      {profile.loading ? (
        <Loading />
      ) : (
        profile.data && (
          <article className="card">
            <h2>{textValue(profile.data.display_name ?? profile.data.username)}</h2>
            <SettingsImage
              client={client}
              title="头像"
              source={profile.data.avatar_url}
              path="/api/assets/v2/user-assets/"
              entityType="USER_AVATAR"
              refresh={profile.refresh}
            />
            <SettingsImage
              client={client}
              title="封面"
              source={profile.data.cover_image_url}
              path="/api/assets/v2/user-assets/"
              entityType="USER_COVER"
              refresh={profile.refresh}
            />
            <dl className="record-fields">
              <div>
                <dt>用户名</dt>
                <dd>{textValue(profile.data.username)}</dd>
              </div>
              <div>
                <dt>邮箱</dt>
                <dd>{textValue(profile.data.email)}</dd>
              </div>
              <div>
                <dt>时区</dt>
                <dd>{textValue(profile.data.user_timezone)}</dd>
              </div>
            </dl>
            <button
              className="button"
              onClick={() =>
                setEditor({
                  title: "编辑个人资料",
                  fields: fields.map((field) => Object.assign({}, field, { value: profile.data?.[field.key] })),
                  submit: async (values) => {
                    await api.updatePersonal(values);
                    await profile.refresh();
                  },
                })
              }
            >
              编辑个人资料
            </button>
          </article>
        )
      )}
      <ErrorMessage error={profile.error} />
      <PreferencesSettings client={client} onThemeChange={onThemeChange} />
      {preferences.data && (
        <article className="card">
          <h2>通知偏好</h2>
          {Object.entries(preferences.data)
            .filter(([, value]) => typeof value === "boolean")
            .map(([key, value]) => (
              <label className="field" key={key}>
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
        </article>
      )}
      <article className="card">
        <h2>连接</h2>
        <p className="value">{client.server}</p>
        <button className="button" onClick={onServerChange}>
          切换服务器
        </button>
        <ActionButton action={async () => onLogout()}>退出登录</ActionButton>
      </article>
      <ApiTokenSettings client={client} />
      <article className="card">
        <h2>账号</h2>
        <button
          className="button danger"
          onClick={() =>
            setConfirmation({
              title: "停用账号？操作会退出当前登录。",
              action: async () => {
                await client.request("/api/users/me/", "DELETE");
                await onLogout();
              },
            })
          }
        >
          停用账号
        </button>
      </article>
      <SettingsForms
        editor={editor}
        confirmation={confirmation}
        close={() => {
          setEditor(undefined);
          setConfirmation(undefined);
        }}
      />
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
  const invitations = useData(client, workspaceSlug && manage ? `${base}invitations/` : null);
  const [tab, setTab] = useState("general");
  const [memberSearch, setMemberSearch] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const api = useMemo(() => new SettingsApi(client), [client]);
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
          ...(manage
            ? [
                { key: "invites", title: "邀请" },
                { key: "webhooks", title: "Webhooks" },
              ]
            : []),
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
      {tab === "invites" && (
        <>
          <button
            className="button primary"
            onClick={() =>
              setEditor({
                title: "邀请成员",
                fields: [
                  { key: "email", label: "邮箱", type: "email", required: true },
                  { key: "role", label: "角色", type: "select", options: roleOptions, value: "15", required: true },
                ],
                submit: async (values) => {
                  await api.invite(workspaceSlug, values.email, values.role);
                  await invitations.refresh();
                },
              })
            }
          >
            邀请成员
          </button>
          <div className="list">
            {records(invitations.data).map((invitation) => (
              <article className="card" key={invitation.id}>
                <h3>{textValue(invitation.email)}</h3>
                <p>
                  {roleName(invitation.role)} · {invitation.accepted ? "已加入" : "待加入"}
                </p>
                <button
                  className="button danger"
                  onClick={() =>
                    setConfirmation({
                      title: "撤回邀请？",
                      action: async () => {
                        await client.request(`${base}invitations/${invitation.id}/`, "DELETE");
                        await invitations.refresh();
                      },
                    })
                  }
                >
                  撤回邀请
                </button>
              </article>
            ))}
          </div>
          <ErrorMessage error={invitations.error} />
        </>
      )}
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

function AdminSettings({ client }: Pick<Props, "client">) {
  const adminClient = useMemo(() => new ApiClient(client.server), [client.server]);
  const api = useMemo(() => new SettingsApi(adminClient), [adminClient]);
  const [logged, setLogged] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loginError, setLoginError] = useState<unknown>();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    adminClient.onSessionExpired = () => {
      if (live) setLogged(false);
    };
    void adminClient
      .request<Entity>("/api/instances/admins/session/")
      .then((session) => {
        if (live) setLogged(Boolean(session.is_authenticated));
        return session;
      })
      .catch(() => {})
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [adminClient]);
  const instance = useData<Entity>(adminClient, logged ? "/api/instances/" : null);
  const configs = useData(adminClient, logged ? "/api/instances/configurations/" : null);
  const admins = useData(adminClient, logged ? "/api/instances/admins/" : null);
  const [workspacePage, setWorkspacePage] = useState("");
  const workspaces = useData<Entity>(adminClient, logged ? `/api/instances/workspaces/${workspacePage}` : null);
  const [tab, setTab] = useState("general");
  const [editor, setEditor] = useState<Editor>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const close = () => {
    setEditor(undefined);
    setConfirmation(undefined);
  };
  if (checking)
    return (
      <>
        <PageHeading title="God Mode" />
        <Loading />
      </>
    );
  if (!logged)
    return (
      <>
        <PageHeading title="God Mode 登录" />
        <form
          className="card"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setLoginError(undefined);
            try {
              await api.adminLogin(username, code);
              await client.refreshCsrf();
              setCode("");
              setLogged(true);
            } catch (error) {
              setLoginError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>用户名</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>动态码</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
          <ErrorMessage error={loginError} />
          <button className="button primary" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </>
    );
  const instanceData = (instance.data?.instance as Entity) ?? {};
  return (
    <>
      <PageHeading title="God Mode">
        <ActionButton
          action={async () => {
            await adminClient.request("/api/instances/admins/sign-out/", "POST", {});
            await client.refreshCsrf();
            setLogged(false);
          }}
        >
          退出管理账号
        </ActionButton>
      </PageHeading>
      <nav className="tabs">
        {[
          { key: "general", title: "实例" },
          { key: "config", title: "配置" },
          { key: "admins", title: "管理员" },
          { key: "workspaces", title: "工作区" },
        ].map((item) => (
          <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
            {item.title}
          </button>
        ))}
      </nav>
      {tab === "general" && (
        <article className="card">
          <h2>{textValue(instanceData.instance_name)}</h2>
          <dl className="record-fields">
            <div>
              <dt>版本</dt>
              <dd>{textValue(instanceData.current_version)}</dd>
            </div>
            <div>
              <dt>遥测</dt>
              <dd>{instanceData.is_telemetry_enabled ? "已开启" : "已关闭"}</dd>
            </div>
          </dl>
          <button
            className="button"
            onClick={() =>
              setEditor({
                title: "实例设置",
                fields: [
                  { key: "instance_name", label: "实例名称", required: true, value: instanceData.instance_name },
                  {
                    key: "is_telemetry_enabled",
                    label: "遥测",
                    type: "select",
                    value: String(Boolean(instanceData.is_telemetry_enabled)),
                    options: [
                      { value: "true", label: "开启" },
                      { value: "false", label: "关闭" },
                    ],
                  },
                ],
                submit: async (values) => {
                  await adminClient.request("/api/instances/", "PATCH", {
                    ...values,
                    is_telemetry_enabled: values.is_telemetry_enabled === "true",
                  });
                  await instance.refresh();
                },
              })
            }
          >
            编辑实例
          </button>
        </article>
      )}
      {tab === "config" && (
        <div className="list">
          {records(configs.data).map((config) => (
            <article className="card" key={config.id}>
              <h3>{textValue(config.key)}</h3>
              <p className="value">{config.is_encrypted ? "••••••••" : textValue(config.value)}</p>
              <button
                className="button"
                onClick={() =>
                  setEditor({
                    title: textValue(config.key),
                    fields: [
                      {
                        key: "value",
                        label: "值",
                        type: config.is_encrypted ? "password" : "text",
                        value: config.is_encrypted ? "" : config.value,
                      },
                    ],
                    submit: async (values) => {
                      await adminClient.request("/api/instances/configurations/", "PATCH", {
                        [String(config.key)]: values.value,
                      });
                      await configs.refresh();
                      await instance.refresh();
                    },
                  })
                }
              >
                编辑
              </button>
            </article>
          ))}
        </div>
      )}
      {tab === "admins" && (
        <div className="list">
          {records(admins.data).map((admin) => (
            <article className="card" key={admin.id}>
              <h3>{textValue(admin.user_detail)}</h3>
              <p>{roleName(admin.role)}</p>
              <button
                className="button danger"
                onClick={() =>
                  setConfirmation({
                    title: "移除管理员？",
                    action: async () => {
                      await adminClient.request(`/api/instances/admins/${admin.id}/`, "DELETE");
                      await admins.refresh();
                    },
                  })
                }
              >
                移除管理员
              </button>
            </article>
          ))}
        </div>
      )}
      {tab === "workspaces" && (
        <>
          <button
            className="button primary"
            onClick={() =>
              setEditor({
                title: "创建工作区",
                fields: [
                  { key: "name", label: "名称", required: true },
                  { key: "slug", label: "地址标识", required: true },
                ],
                submit: async (values) => {
                  const availability = await adminClient.request<Entity>(
                    `/api/instances/workspace-slug-check/?slug=${encodeURIComponent(values.slug)}`
                  );
                  if (!availability.status) throw new Error("工作区地址已占用");
                  await adminClient.request("/api/instances/workspaces/", "POST", values);
                  await workspaces.refresh();
                },
              })
            }
          >
            创建工作区
          </button>
          <div className="list">
            {records(workspaces.data).map((workspace) => (
              <article className="card" key={workspace.id}>
                <h3>{workspace.name}</h3>
                <dl className="record-fields">
                  <div>
                    <dt>地址</dt>
                    <dd>{textValue(workspace.slug)}</dd>
                  </div>
                  <div>
                    <dt>项目</dt>
                    <dd>{textValue(workspace.total_projects)}</dd>
                  </div>
                  <div>
                    <dt>成员</dt>
                    <dd>{textValue(workspace.total_members)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <div className="actions">
            <button
              className="button"
              disabled={!workspaces.data?.prev_page_results}
              onClick={() => setWorkspacePage(`?cursor=${encodeURIComponent(String(workspaces.data?.prev_cursor))}`)}
            >
              上一页
            </button>
            <button
              className="button"
              disabled={!workspaces.data?.next_page_results}
              onClick={() => setWorkspacePage(`?cursor=${encodeURIComponent(String(workspaces.data?.next_cursor))}`)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      <ErrorMessage error={instance.error ?? configs.error ?? admins.error ?? workspaces.error} />
      <SettingsForms editor={editor} confirmation={confirmation} close={close} />
      <AdminReauthentication client={adminClient} />
    </>
  );
}

export function SettingsFeature(props: Props) {
  if (props.section === "personal") return <PersonalSettings {...props} />;
  if (props.section === "workspace") return <WorkspaceSettings {...props} />;
  if (props.section === "project") return <ProjectSettings {...props} />;
  return <AdminSettings client={props.client} />;
}
