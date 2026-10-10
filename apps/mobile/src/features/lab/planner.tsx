/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { LabEvent, LabItem, LabTask, LabMember } from "@plane/types";
import type { LabStore } from "./transport";
import { useResource } from "./transport";
import { Button, LabDialog, LabField, Tabs, ErrorMessage, Empty, KeyValues } from "./ui";
import { today, monthDays, scheduleMutation } from "./business";
import { calendarInstant, localInput } from "./calendar-time";
import { Fields } from "./fields";
import { Gantt } from "./gantt";
const statuses = [
  { id: "todo", name: "待做" },
  { id: "active", name: "进行中" },
  { id: "review", name: "待验收" },
  { id: "done", name: "完成" },
];
export function Planner({
  store,
  team = false,
  onOpenIssue,
  onOpenBounty,
}: {
  store: LabStore;
  team?: boolean;
  onOpenIssue?: (project: string, issue: string) => void;
  onOpenBounty: (id: string) => void;
}) {
  const [view, setView] = useState(team ? "agenda" : "board");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [day, setDay] = useState(today());
  const [folder, setFolder] = useState("all");
  const [project, setProject] = useState("");
  const [member, setMember] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<
    "item" | "reference" | "folder" | "category" | "mapping" | "folder-list" | "category-list"
  >();
  const [chosenItem, setChosenItem] = useState<LabItem>();
  const [chosenFolder, setChosenFolder] = useState<{ id: string; name: string }>();
  const [chosenCategory, setChosenCategory] = useState<{ id: string; name: string; color: string }>();
  const [schedule, setSchedule] = useState<LabEvent | "new">();
  const [scheduledItem, setScheduledItem] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; title: string; revision?: number }>();
  const planner = store.planner;
  const last = monthDays(month).at(-1)!;
  const params = new URLSearchParams({
    start: calendarInstant(`${month}-01T00:00`),
    end: new Date(new Date(calendarInstant(`${last}T00:00`)).getTime() + 86400000).toISOString(),
    team: team ? "1" : "0",
  });
  if (project) params.set("project_id", project);
  if (member) params.set("user_id", member);
  const calendar = useResource<{ events: LabEvent[]; members: LabMember[] }>(
    store,
    ["agenda", "month", "week", "timeline"].includes(view) ? `calendar/?${params}` : null
  );
  const search = useResource<LabTask[]>(
    store,
    dialog === "reference" ? `tasks/?q=${encodeURIComponent(query)}${project ? `&project_id=${project}` : ""}` : null
  );
  const rows = (planner?.items ?? []).filter(
    (item) =>
      (folder === "all" || (folder === "unclassified" ? !item.folder_id : item.folder_id === folder)) &&
      (!status || item.status === status) &&
      (!project || item.project_id === project) &&
      `${item.title} ${item.description ?? ""} ${item.issue_key ?? ""}`.toLowerCase().includes(query.toLowerCase())
  );
  const events = (calendar.data?.events ?? []).filter(
    (row) =>
      team ||
      folder === "all" ||
      planner?.items.some(
        (item) => item.id === row.item_id && (folder === "unclassified" ? !item.folder_id : item.folder_id === folder)
      )
  );
  const run = (fn: () => Promise<void>) => store.execute(fn).catch(() => {});
  const reload = async () => {
    await store.loadPlanner();
    if (["agenda", "month", "week", "timeline"].includes(view)) await calendar.refresh();
  };
  const mutate = async (path: string, method: string, body?: unknown) => {
    await store.request(path, method, body);
    await reload();
  };
  const openItem = (item: LabItem) => {
    if (item.bounty_id && item.can_open_issue === false) onOpenBounty(item.bounty_id);
    else if (item.issue_id && item.project_id && item.can_open_issue !== false && onOpenIssue)
      onOpenIssue(item.project_id, item.issue_id);
    else {
      setChosenItem(item);
      setDialog("item");
    }
  };
  function card(item: LabItem) {
    return (
      <article className="lab-card" key={item.id}>
        <button className="lab-card-row" onClick={() => openItem(item)}>
          <small className="lab-muted">
            {item.issue_key ?? (item.public ? "公开事项" : "私人事项")} ·{" "}
            {item.project_name ?? item.category_name ?? "个人"}
          </small>
          <h3>{item.title}</h3>
          <p className="lab-muted">{item.description}</p>
        </button>
        <KeyValues
          values={{
            状态: statuses.find((row) => row.id === item.status)?.name,
            截止: item.target_date,
            本周计划: `${(item.schedule?.week_minutes ?? 0) / 60} 小时`,
            最近排期: item.schedule?.next_start
              ? new Date(item.schedule.next_start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
              : "尚未安排",
          }}
        />
        <div className="lab-actions">
          <Button
            onClick={() => {
              setScheduledItem(item.id);
              setSchedule("new");
            }}
          >
            安排时间
          </Button>
          <Button
            onClick={() => {
              setChosenItem(item);
              setDialog("item");
            }}
          >
            整理事项
          </Button>
          {item.bounty_id && <Button onClick={() => onOpenBounty(item.bounty_id!)}>悬赏流程</Button>}
        </div>
      </article>
    );
  }
  function eventCard(row: LabEvent) {
    return (
      <article
        className="lab-timeline-row"
        key={row.id}
        style={{ borderColor: row.category_color || row.color || undefined }}
      >
        <small className="lab-muted">
          {new Date(row.start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} —{" "}
          {new Date(row.end).toLocaleTimeString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </small>
        <h3>{row.title || "忙碌"}</h3>
        <p className="lab-muted">
          {calendar.data?.members.find((person) => person.id === row.user_id)?.name} · {row.category_name}
        </p>
        <div className="lab-actions">
          {row.editable && <Button onClick={() => setSchedule({ ...row })}>调整时间</Button>}
          {row.issue_id && row.project_id && row.can_open_issue !== false && onOpenIssue && (
            <Button onClick={() => onOpenIssue(row.project_id!, row.issue_id!)}>查看任务</Button>
          )}
          {row.bounty_id && <Button onClick={() => onOpenBounty(row.bounty_id!)}>悬赏详情</Button>}
        </div>
      </article>
    );
  }
  if (!planner)
    return (
      <>
        <ErrorMessage error={store.error} />
        <Empty>正在加载规划…</Empty>
      </>
    );
  return (
    <>
      <div className="lab-heading">
        <h2>{team ? "团队排期" : "个人规划"}</h2>
        <Button onClick={() => void run(reload)}>刷新</Button>
      </div>
      <ErrorMessage error={store.error || calendar.error} />
      {notice && (
        <p role="status" className="lab-muted">
          {notice}
        </p>
      )}
      {team && !planner.team_access ? (
        <Empty>你没有查看团队排期的权限。</Empty>
      ) : (
        <>
          <Tabs
            value={view}
            onChange={setView}
            items={
              team
                ? [
                    { id: "agenda", name: "日程" },
                    { id: "month", name: "月历" },
                    { id: "week", name: "周历" },
                    { id: "timeline", name: "时间轴" },
                    { id: "gantt", name: "甘特" },
                  ]
                : [
                    { id: "board", name: "看板" },
                    { id: "list", name: "列表" },
                    { id: "agenda", name: "日程" },
                    { id: "month", name: "月历" },
                    { id: "week", name: "周历" },
                    { id: "timeline", name: "时间轴" },
                    { id: "gantt", name: "甘特" },
                    { id: "fields", name: "字段" },
                  ]
            }
          />
          <div className="lab-actions">
            {!team && (
              <>
                <Button
                  onClick={() => {
                    setChosenItem(undefined);
                    setDialog("item");
                  }}
                >
                  新建事项
                </Button>
                <Button
                  onClick={() => {
                    setQuery("");
                    setDialog("reference");
                  }}
                >
                  引用项目任务
                </Button>
                <Button onClick={() => setDialog("folder-list")}>文件夹</Button>
                <Button onClick={() => setDialog("category-list")}>分类</Button>
                <Button onClick={() => setDialog("mapping")}>状态映射</Button>
              </>
            )}
            <Button
              onClick={() => {
                setScheduledItem(rows[0]?.id ?? "");
                setSchedule("new");
              }}
            >
              新建时间块
            </Button>
          </div>
          <input
            className="lab-input"
            placeholder="搜索事项或任务编号"
            aria-label="搜索规划"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="lab-grid">
            <LabField label="项目">
              <select value={project} onChange={(event) => setProject(event.target.value)}>
                <option value="">全部项目</option>
                {planner.projects.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </LabField>
            {team ? (
              <LabField label="成员">
                <select value={member} onChange={(event) => setMember(event.target.value)}>
                  <option value="">全部成员</option>
                  {calendar.data?.members.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </LabField>
            ) : (
              <LabField label="状态">
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">全部状态</option>
                  {statuses.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </LabField>
            )}
          </div>
          {!team && (
            <div className="lab-folder-grid">
              {[{ id: "all", name: "全部事项" }, { id: "unclassified", name: "未分类" }, ...planner.folders].map(
                (row) => (
                  <button
                    key={row.id}
                    className={`lab-chip ${folder === row.id ? "active" : ""}`}
                    onClick={() => setFolder(row.id)}
                  >
                    {row.name}
                  </button>
                )
              )}
            </div>
          )}
          {view === "board" &&
            statuses
              .filter((row) => !status || status === row.id)
              .map((row) => (
                <section key={row.id}>
                  <div className="lab-heading">
                    <h3>{row.name}</h3>
                    <span className="lab-badge">{rows.filter((item) => item.status === row.id).length}</span>
                  </div>
                  {rows.filter((item) => item.status === row.id).map(card)}
                </section>
              ))}
          {view === "list" && (rows.length ? rows.map(card) : <Empty />)}
          {["agenda", "month", "week", "timeline"].includes(view) && (
            <>
              <LabField label="排期月份">
                <input
                  type="month"
                  value={month}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setMonth(e.target.value);
                    setDay(`${e.target.value}-01`);
                  }}
                />
              </LabField>
              {view === "month" && (
                <div className="lab-month">
                  {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                  {Array.from({ length: (new Date(`${month}-01T12:00:00+08:00`).getUTCDay() + 6) % 7 }, (_, i) => (
                    <span key={`blank-${i}`} />
                  ))}
                  {monthDays(month).map((date) => (
                    <button
                      key={date}
                      aria-label={date}
                      className={day === date ? "active" : ""}
                      onClick={() => setDay(date)}
                    >
                      {Number(date.slice(-2))}
                      <small>{events.filter((row) => localInput(row.start).slice(0, 10) === date).length || ""}</small>
                    </button>
                  ))}
                </div>
              )}
              {["agenda", "week"].includes(view) && (
                <LabField label={view === "week" ? "所选周的日期" : "日期"}>
                  <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
                </LabField>
              )}
              {view === "timeline"
                ? Array.from(new Set(events.map((row) => row.user_id))).map((user) => (
                    <section key={user}>
                      <h3>{calendar.data?.members.find((row) => row.id === user)?.name ?? "本人"}</h3>
                      {events.filter((row) => row.user_id === user).map(eventCard)}
                    </section>
                  ))
                : events
                    .filter((row) =>
                      view === "week"
                        ? new Date(row.start).getTime() >=
                            new Date(`${day}T00:00:00+08:00`).getTime() -
                              ((new Date(`${day}T12:00:00+08:00`).getUTCDay() + 6) % 7) * 86400000 &&
                          new Date(row.start).getTime() <
                            new Date(`${day}T00:00:00+08:00`).getTime() +
                              (7 - ((new Date(`${day}T12:00:00+08:00`).getUTCDay() + 6) % 7)) * 86400000
                        : localInput(row.start).slice(0, 10) === day
                    )
                    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; only this filtered copy is mutated
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .map(eventCard)}
              {!calendar.loading && !events.length && <Empty>当前日期范围暂无排期。</Empty>}
            </>
          )}
          {view === "gantt" &&
            (project ? (
              <Gantt store={store} projectId={project} onOpenIssue={onOpenIssue} />
            ) : (
              <Empty>选择一个项目查看甘特排期。</Empty>
            ))}
          {view === "fields" && <Fields store={store} projectId={project} onOpenIssue={onOpenIssue} />}
        </>
      )}
      {dialog === "item" && (
        <LabDialog
          title={chosenItem ? "整理事项" : "新建事项"}
          onClose={() => setDialog(undefined)}
          onSubmit={async (form) => {
            const item = chosenItem;
            const body = {
              title: form.get("title"),
              description: form.get("description"),
              category_id: form.get("category_id") || null,
              folder_id: form.get("folder_id") || null,
              public: form.get("public") === "on",
              ...(!(item?.bounty_id || item?.is_bounty) && item?.can_edit_issue !== false
                ? { status: form.get("status") }
                : {}),
            };
            await mutate(item ? `items/${item.id}/` : "items/", item ? "PATCH" : "POST", body);
            setDialog(undefined);
          }}
        >
          <LabField label="标题">
            <input
              name="title"
              required
              maxLength={255}
              defaultValue={chosenItem?.title}
              disabled={!!chosenItem?.issue_id}
            />
          </LabField>
          {!chosenItem?.issue_id && (
            <LabField label="说明">
              <textarea name="description" defaultValue={chosenItem?.description} />
            </LabField>
          )}
          <LabField label="文件夹">
            <select name="folder_id" defaultValue={chosenItem?.folder_id ?? ""}>
              <option value="">未分类</option>
              {planner.folders.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          <LabField label="分类">
            <select name="category_id" defaultValue={chosenItem?.category_id ?? planner.default_category_id ?? ""}>
              <option value="">未分类</option>
              {planner.categories?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </LabField>
          {!chosenItem?.bounty_id && !chosenItem?.is_bounty && chosenItem?.can_edit_issue !== false && (
            <LabField label="状态">
              <select name="status" defaultValue={chosenItem?.status ?? "todo"}>
                {statuses.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </LabField>
          )}
          {!chosenItem?.issue_id && (
            <label>
              <input name="public" type="checkbox" defaultChecked={chosenItem?.public} />
              团队可查看事项内容
            </label>
          )}
          {chosenItem && (
            <Button onClick={() => setDeleteTarget({ path: `items/${chosenItem.id}/`, title: chosenItem.title })}>
              移除个人规划引用
            </Button>
          )}
          {chosenItem?.bounty_id && (
            <Button
              onClick={() => {
                setDialog(undefined);
                onOpenBounty(chosenItem.bounty_id!);
              }}
            >
              处理悬赏状态
            </Button>
          )}
        </LabDialog>
      )}
      {dialog === "reference" && (
        <LabDialog
          title="引用项目任务"
          onClose={() => setDialog(undefined)}
          onSubmit={async (form) => {
            await mutate("items/", "POST", {
              issue_id: form.get("issue_id"),
              folder_id: folder === "all" || folder === "unclassified" ? null : folder,
              category_id: planner.default_project_category_id || null,
            });
            setDialog(undefined);
          }}
        >
          <LabField label="搜索任务">
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </LabField>
          <ErrorMessage error={search.error} />
          <LabField label="任务">
            <select name="issue_id" required>
              <option value="">请选择</option>
              {search.data?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.project} · {row.key} {row.title}
                </option>
              ))}
            </select>
          </LabField>
        </LabDialog>
      )}
      {(dialog === "folder-list" || dialog === "category-list") && (
        <LabDialog title={dialog === "folder-list" ? "文件夹管理" : "分类管理"} onClose={() => setDialog(undefined)}>
          <Button
            onClick={() => {
              if (dialog === "folder-list") {
                setChosenFolder(undefined);
                setDialog("folder");
              } else {
                setChosenCategory(undefined);
                setDialog("category");
              }
            }}
          >
            新增
          </Button>
          {(dialog === "folder-list" ? planner.folders : (planner.categories ?? [])).map((row, index, array) => (
            <div className="lab-card" key={row.id}>
              <h3>{row.name}</h3>
              <div className="lab-actions">
                <Button
                  onClick={() => {
                    if (dialog === "folder-list") {
                      setChosenFolder(row);
                      setDialog("folder");
                    } else {
                      setChosenCategory({
                        id: row.id,
                        name: row.name,
                        color: "color" in row ? String(row.color) : "#0f766e",
                      });
                      setDialog("category");
                    }
                  }}
                >
                  编辑
                </Button>
                {dialog === "folder-list" && (
                  <Button
                    disabled={index === 0}
                    onClick={() =>
                      void run(async () => {
                        const ids = array.map((r) => r.id);
                        [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                        await mutate(dialog === "folder-list" ? "folders/" : "categories/", "PUT", { ids });
                      })
                    }
                  >
                    上移
                  </Button>
                )}
                <Button
                  onClick={() =>
                    setDeleteTarget({
                      path: `${dialog === "folder-list" ? "folders" : "categories"}/${row.id}/`,
                      title: row.name,
                    })
                  }
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </LabDialog>
      )}
      {(dialog === "folder" || dialog === "category") && (
        <LabDialog
          title={dialog === "folder" ? "编辑文件夹" : "编辑分类"}
          onClose={() => setDialog(undefined)}
          onSubmit={async (form) => {
            const chosen = dialog === "folder" ? chosenFolder : chosenCategory;
            const base = dialog === "folder" ? "folders" : "categories";
            await mutate(`${base}/${chosen ? `${chosen.id}/` : ""}`, chosen ? "PATCH" : "POST", {
              name: form.get("name"),
              ...(base === "categories" ? { color: form.get("color") } : {}),
            });
            setDialog(undefined);
          }}
        >
          <LabField label="名称">
            <input
              name="name"
              maxLength={40}
              required
              defaultValue={(dialog === "folder" ? chosenFolder : chosenCategory)?.name}
            />
          </LabField>
          {dialog === "category" && (
            <LabField label="颜色">
              <input name="color" type="color" defaultValue={chosenCategory?.color ?? "#0f766e"} />
            </LabField>
          )}
        </LabDialog>
      )}
      {dialog === "mapping" && (
        <LabDialog
          title="个人状态与项目状态映射"
          onClose={() => setDialog(undefined)}
          onSubmit={async (form) => {
            const id = String(form.get("project_id"));
            await mutate(`flows/${id}/`, "PUT", Object.fromEntries(statuses.map((row) => [row.id, form.get(row.id)])));
            setDialog(undefined);
          }}
        >
          <LabField label="项目">
            <select name="project_id" value={project} required onChange={(e) => setProject(e.target.value)}>
              <option value="">请选择</option>
              {planner.projects
                .filter((row) => row.lead)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </LabField>
          {statuses.map((row) => (
            <LabField key={row.id} label={row.name}>
              <select
                key={`${project}-${row.id}`}
                name={row.id}
                defaultValue={planner.projects.find((p) => p.id === project)?.mapping[row.id as "todo"] ?? ""}
              >
                <option value="">不映射</option>
                {planner.projects
                  .find((p) => p.id === project)
                  ?.states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
              </select>
            </LabField>
          ))}
        </LabDialog>
      )}
      {schedule && (
        <LabDialog
          title={schedule === "new" ? "安排时间" : "调整排期"}
          onClose={() => setSchedule(undefined)}
          onSubmit={async (form) => {
            const event = schedule === "new" ? undefined : schedule;
            try {
              const result = await store.request<{ overlap?: boolean }>(
                event ? `calendar/${event.id}/` : "calendar/",
                event ? "PATCH" : "POST",
                {
                  ...scheduleMutation(event, String(form.get("start")), String(form.get("end"))),
                  ...(event ? {} : { item_id: form.get("item_id") }),
                  color: String(form.get("color") ?? ""),
                }
              );
              setNotice(result.overlap ? "已保存；排期有重叠，请确认投入安排。" : "排期已保存");
              await reload();
              setSchedule(undefined);
            } catch (e) {
              await reload().catch(() => {});
              throw e;
            }
          }}
        >
          {schedule === "new" && (
            <LabField label="事项">
              <select name="item_id" required defaultValue={scheduledItem}>
                <option value="">请选择</option>
                {planner.items.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </LabField>
          )}
          <LabField label="开始时间（上海）">
            <input
              type="datetime-local"
              name="start"
              step={900}
              required
              defaultValue={schedule === "new" ? `${day}T09:00` : localInput(schedule.start)}
            />
          </LabField>
          <LabField label="结束时间（上海）">
            <input
              type="datetime-local"
              name="end"
              step={900}
              required
              defaultValue={schedule === "new" ? `${day}T10:00` : localInput(schedule.end)}
            />
          </LabField>
          <LabField label="自定义颜色">
            <input
              name="color"
              type="color"
              defaultValue={schedule === "new" ? "#0f766e" : schedule.color || "#0f766e"}
            />
          </LabField>
          {schedule !== "new" && (
            <>
              <LabField label="拆分时间（上海）">
                <input name="split_at" type="datetime-local" step={900} />
              </LabField>
              <Button
                onClick={async (e) => {
                  const form = e.currentTarget.closest("form");
                  const split = String(new FormData(form!).get("split_at") ?? "");
                  if (!split) {
                    setNotice("请先填写拆分时间");
                    return;
                  }
                  await run(async () => {
                    await mutate(`calendar/${schedule.id}/`, "PATCH", {
                      expected_revision: schedule.revision,
                      split_at: calendarInstant(split),
                    });
                    setSchedule(undefined);
                  });
                }}
              >
                拆分时间块
              </Button>
              <Button
                onClick={() =>
                  setDeleteTarget({
                    path: `calendar/${schedule.id}/`,
                    title: schedule.title,
                    revision: schedule.revision,
                  })
                }
              >
                删除时间块
              </Button>
            </>
          )}
        </LabDialog>
      )}
      {deleteTarget && (
        <LabDialog
          title={`删除 ${deleteTarget.title}`}
          destructive
          onClose={() => setDeleteTarget(undefined)}
          onSubmit={async () => {
            await mutate(
              deleteTarget.path,
              "DELETE",
              deleteTarget.revision === undefined ? undefined : { expected_revision: deleteTarget.revision }
            );
            setDeleteTarget(undefined);
            setSchedule(undefined);
            setDialog(undefined);
          }}
        >
          <p>确认删除此记录？项目任务本体不会因移除规划引用而删除。</p>
        </LabDialog>
      )}
    </>
  );
}
