import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { SWRConfig, useSWRConfig } from "swr";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { CanonicalIcon, MobileHeaderContext } from "./components/navigation";
import { MobileStore, type MobileRoute, type MobileUser } from "@plane/shared-state/mobile";
import { ApiClient, nativeTransport } from "./lib/client";
import { requestMobileNavigation } from "./lib/mobile-navigation";
import { ErrorMessage, FormSheet, Loading, Sheet, records, useData } from "./components/ui";
import { MobileClientContext } from "./components/rich-editor";
import { Login, ServerSetup } from "./features/auth";
import { Home, Inbox, SearchPage } from "./features/home";
import More from "./features/more";
import Stickies from "./features/stickies";
import LabFeature from "./features/lab";
import CoreFeature from "./features/core";
import { SettingsFeature } from "./features/settings";
import Documents from "./features/documents";
import Space from "./features/space";
import WorkspaceFeature from "./features/workspace";
import type { MobileTheme } from "./features/settings/preferences";

const store = new MobileStore();
const savedTheme = localStorage.getItem("ooa.theme");
if (["light", "dark", "system", "custom"].includes(savedTheme ?? ""))
  store.setTheme(savedTheme as MobileTheme["theme"]);
const initialServer = localStorage.getItem("ooa.server") ?? "";
const pageTitles: Record<string, string> = {
  more: "工作台",
  inbox: "收件箱",
  search: "搜索",
  projects: "项目",
  "project-overview": "项目概览",
  "my-tasks": "我的任务",
  tasks: "工作项",
  issue: "",
  cycles: "周期",
  modules: "模块",
  views: "视图",
  intake: "需求收集",
  "archived-tasks": "归档任务",
  planner: "个人规划",
  team: "团队排期",
  "task-table": "任务表格",
  bounties: "悬赏大厅",
  finance: "资金与奖励",
  analytics: "数据总览",
  contributions: "我的项目与 VC",
  workflow: "流程设置",
  documents: "文档",
  document: "文档",
  "lab-documents": "关联文档",
  widgets: "管理首页组件",
  stickies: "便签",
  drafts: "草稿",
  activity: "我的活动",
  "workspace-views": "工作区视图",
  "active-cycles": "活跃周期",
  "workspace-analytics": "工作区统计",
  commands: "快捷入口",
  space: "共享项目",
  settings: "个人设置",
  "workspace-settings": "工作区设置",
  "project-settings": "项目设置",
};
const projectLinks = [
  ["project-overview", "概览"],
  ["tasks", "工作项"],
  ["documents", "文档"],
  ["cycles", "周期"],
  ["modules", "模块"],
  ["views", "视图"],
  ["intake", "需求收集"],
  ["archived-tasks", "归档"],
  ["project-settings", "设置"],
] as const;
const App = observer(function App() {
  const [server, setServer] = useState(initialServer);
  const [setup, setSetup] = useState(!initialServer);
  const [loading, setLoading] = useState(Boolean(initialServer));
  const [epoch, setEpoch] = useState(0);
  const client = useMemo(() => new ApiClient(server || "https://unconfigured.invalid"), [server]);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [workspacePicker, setWorkspacePicker] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [fab, setFab] = useState<HTMLElement | null>(null);
  const [composer, setComposer] = useState<HTMLElement | null>(null);
  const [headerTitle, setHeaderTitle] = useState<HTMLElement | null>(null);
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null);
  const [headerBack, setHeaderBack] = useState<HTMLElement | null>(null);
  const [customTheme, setCustomTheme] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("ooa.custom-theme") ?? "{}");
    } catch {
      return {};
    }
  });
  const [online, setOnline] = useState(navigator.onLine);
  const workspaces = useData(client, store.user ? "/api/users/me/workspaces/" : null);
  const { mutate } = useSWRConfig();
  const theme = store.theme;
  const navigate = useCallback((route: MobileRoute) => requestMobileNavigation(() => store.navigate(route)), []);
  const back = useCallback((fallback?: () => void, minimize = false) => {
    const event = new Event("mobileBack", { cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) return;
    requestMobileNavigation(() => {
      if (store.back()) return;
      if (fallback) fallback();
      else if (minimize) void NativeApp.minimizeApp();
      else store.root("home");
    });
  }, []);
  const restore = useCallback(async () => {
    const session = await client.request<{ user: MobileUser; client_platform: string; mobile_api_version: number }>(
      "/api/lab/session/"
    );
    if (session.client_platform !== "android" || session.mobile_api_version !== 1) {
      await client.clearSession();
      throw new Error("请重新登录移动账号");
    }
    store.setUser(session.user);
    await client.refreshCsrf();
  }, [client]);
  const logout = useCallback(async () => {
    try {
      await Promise.allSettled([client.request("/auth/sign-out/", "POST")]);
    } finally {
      await client.clearSession();
      store.reset();
      await mutate(() => true, undefined, { revalidate: false });
      setEpoch((e) => e + 1);
    }
  }, [client, mutate]);
  const switchServer = useCallback(
    async (root: string) => {
      if (server && server !== root) {
        try {
          await logout();
        } catch {
          await client.clearSession();
        }
      }
      store.reset();
      setEpoch((e) => e + 1);
      localStorage.setItem("ooa.server", root);
      setServer(root);
      setSetup(false);
      setLoading(false);
      setError(undefined);
    },
    [server, logout, client]
  );
  useEffect(() => {
    client.onSessionExpired = () => {
      if (!store.user) return;
      store.reset();
      void client.clearSession().catch(setError);
      void mutate(() => true, undefined, { revalidate: false });
      setError(new Error("登录已失效，请重新登录"));
    };
    return () => {
      client.onSessionExpired = undefined;
    };
  }, [client, mutate]);
  useEffect(() => {
    if (!server || setup) return;
    let active = true;
    setLoading(true);
    restore()
      .catch(() => {
        store.reset();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [server, setup, restore]);
  useEffect(() => {
    const items = records(workspaces.data);
    if (items.length && !items.some((item) => item.slug === store.workspaceSlug)) {
      const saved = localStorage.getItem("ooa.workspace");
      store.setWorkspace(String(items.find((item) => item.slug === saved)?.slug ?? items[0].slug));
    }
  }, [workspaces.data]);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    const showNotice = (event: Event) => setNotice(String((event as CustomEvent).detail));
    window.addEventListener("mobileNotice", showNotice);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    if (!Capacitor.isNativePlatform())
      return () => {
        window.removeEventListener("mobileNotice", showNotice);
        window.removeEventListener("online", updateOnline);
        window.removeEventListener("offline", updateOnline);
      };
    const plugins = [
      NativeApp.addListener("backButton", () => {
        back(undefined, true);
      }),
      NativeApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          void mutate(() => true);
          window.dispatchEvent(new Event("mobileResume"));
        }
      }),
      Keyboard.addListener("keyboardDidShow", () => document.documentElement.classList.add("keyboard-open")),
      Keyboard.addListener("keyboardDidHide", () => document.documentElement.classList.remove("keyboard-open")),
    ];
    const applyInsets = (insets: { top: number; bottom: number }) => {
      document.documentElement.style.setProperty("--native-inset-top", `${insets.top}px`);
      document.documentElement.style.setProperty("--native-inset-bottom", `${insets.bottom}px`);
    };
    void nativeTransport.insets?.().then(applyInsets);
    const insetsChanged = (event: Event) => applyInsets((event as CustomEvent<{ top: number; bottom: number }>).detail);
    window.addEventListener("mobileInsets", insetsChanged);
    return () => {
      plugins.forEach((promise) => {
        void promise.then((listener) => listener.remove());
      });
      window.removeEventListener("mobileInsets", insetsChanged);
      window.removeEventListener("mobileNotice", showNotice);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [mutate, back]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        theme === "dark" ||
        (theme === "system" && media.matches) ||
        (theme === "custom" && customTheme.darkPalette === "true");
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      for (const [variable, value] of [
        ["--accent", customTheme.primary],
        ["--surface", customTheme.background],
        ["--bg", customTheme.background],
        ["--ink", customTheme.text],
        ["--text", customTheme.text],
      ]) {
        if (theme === "custom" && /^#[0-9a-f]{6}$/i.test(value ?? ""))
          document.documentElement.style.setProperty(variable, value);
        else document.documentElement.style.removeProperty(variable);
      }
      localStorage.setItem("ooa.theme", theme);
      if (Capacitor.isNativePlatform()) void nativeTransport.setAppearance?.({ dark });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, customTheme]);
  const route = store.route;
  const variant =
    route.page === "home"
      ? "home"
      : ["project-overview", "tasks", "issue", "archived-tasks"].includes(route.page)
        ? "project"
        : ["more", "planner", "settings"].includes(route.page)
          ? "personal"
          : "standard";
  const backIconSize =
    variant === "project" ? 20 : variant === "personal" ? 21 : ["projects", "finance"].includes(route.page) ? 22 : 24;
  const backIconRotated = variant === "personal" || ["projects", "finance"].includes(route.page);
  const headerContext = useMemo(
    () => ({
      title: headerTitle,
      onBack: back,
      variant: variant as "home" | "project" | "personal" | "standard",
      backIconSize,
      backIconRotated,
      actions: headerActions,
      back: headerBack,
      detail: route.page === "issue",
      composer,
      fab,
    }),
    [headerTitle, headerActions, headerBack, route.page, composer, fab, back, variant, backIconSize, backIconRotated]
  );
  const selectedWorkspace = records(workspaces.data).find((item) => item.slug === store.workspaceSlug);
  if (setup) return <ServerSetup initial={server} onConnect={switchServer} />;
  if (loading)
    return (
      <main className="auth-page">
        <Loading />
      </main>
    );
  if (!store.user && route.page !== "space")
    return (
      <Login
        client={client}
        onLogin={restore}
        onServerChange={() => setSetup(true)}
        onSpace={() => navigate({ page: "space" })}
      />
    );
  const page = route.page;
  const rootLink = (target: string) => requestMobileNavigation(() => store.root(target));
  let content;
  if (page === "home")
    content = (
      <Home
        client={client}
        workspaceSlug={store.workspaceSlug}
        userId={store.user?.id}
        userName={store.user?.display_name || store.user?.username}
        navigate={navigate}
      />
    );
  else if (page === "stickies") content = <Stickies client={client} workspaceSlug={store.workspaceSlug} />;
  else if (page === "more" && store.user)
    content = (
      <More
        client={client}
        workspaceSlug={store.workspaceSlug}
        workspaceName={String(selectedWorkspace?.name ?? "OpenOceanAcoustic")}
        user={store.user}
        navigate={navigate}
        onLogout={logout}
      />
    );
  else if (page === "inbox")
    content = <Inbox client={client} workspaceSlug={store.workspaceSlug} navigate={navigate} />;
  else if (page === "search")
    content = <SearchPage client={client} workspaceSlug={store.workspaceSlug} navigate={navigate} />;
  else if (
    [
      "projects",
      "project-overview",
      "my-tasks",
      "tasks",
      "issue",
      "cycles",
      "modules",
      "views",
      "intake",
      "archived-tasks",
    ].includes(page)
  )
    content = (
      <CoreFeature
        section={page}
        workspaceSlug={store.workspaceSlug}
        projectId={route.projectId}
        issueId={route.issueId}
        client={client}
        onNavigate={navigate}
      />
    );
  else if (
    [
      "planner",
      "team",
      "task-table",
      "bounties",
      "finance",
      "analytics",
      "contributions",
      "workflow",
      "lab-documents",
    ].includes(page)
  )
    content = (
      <LabFeature
        section={page === "task-table" ? "tasks" : page === "lab-documents" ? "documents" : page}
        workspaceSlug={store.workspaceSlug}
        client={client}
        onOpenIssue={(projectId, issueId) => navigate({ page: "issue", projectId, issueId })}
        onOpenProject={(projectId) => navigate({ page: "tasks", projectId })}
        onOpenDocument={(projectId, pageId) => navigate({ page: "document", projectId, pageId })}
      />
    );
  else if (page === "documents" || page === "document")
    content = (
      <Documents
        client={client}
        workspaceSlug={store.workspaceSlug}
        projectId={route.projectId}
        pageId={route.pageId}
        onOpen={(projectId, pageId) =>
          navigate({ page: pageId ? "document" : "documents", projectId, pageId: pageId || undefined })
        }
      />
    );
  else if (
    ["widgets", "drafts", "activity", "workspace-views", "active-cycles", "workspace-analytics", "commands"].includes(
      page
    )
  )
    content = (
      <WorkspaceFeature section={page} client={client} workspaceSlug={store.workspaceSlug} onNavigate={navigate} />
    );
  else if (page === "space") content = <Space client={client} />;
  else if (["settings", "workspace-settings", "project-settings"].includes(page))
    content = (
      <SettingsFeature
        section={page === "workspace-settings" ? "workspace" : page === "project-settings" ? "project" : "personal"}
        workspaceSlug={store.workspaceSlug}
        projectId={route.projectId}
        client={client}
        onServerChange={() => setSetup(true)}
        onLogout={logout}
        onWorkspaceChanged={async () => {
          await workspaces.refresh();
        }}
        onThemeChange={(next, custom) => {
          if (custom) {
            setCustomTheme(custom);
            localStorage.setItem("ooa.custom-theme", JSON.stringify(custom));
          }
          store.setTheme(next);
        }}
      />
    );
  else content = <p className="empty">页面不存在</p>;
  return (
    <MobileClientContext.Provider value={client}>
      <MobileHeaderContext.Provider value={headerContext}>
        <div className="app-shell v6-app" data-page={page} data-header={variant} key={epoch}>
          <div className="phone-content app-content">
            <header
              className={`topbar ${page === "home" ? "home-topbar" : `m3-topbar ${variant === "project" ? "px-topbar" : variant === "personal" ? "pm-topbar" : "bx-topbar"}`}`}
            >
              {page === "home" ? (
                <>
                  <button
                    className="workspace-picker"
                    aria-label="切换工作空间"
                    onClick={() => setWorkspacePicker(true)}
                  >
                    <span className="workspace-icon">声</span>
                    <span className="workspace-copy">
                      <strong>OpenOceanAcoustic</strong>
                      <span>{String(selectedWorkspace?.name ?? "工作空间")}</span>
                    </span>
                    <CanonicalIcon name="down" size={16} />
                  </button>
                  <button
                    className="account-avatar"
                    aria-label="个人资料"
                    onClick={() => navigate({ page: "settings" })}
                  >
                    {(store.user?.display_name || store.user?.username || "声").slice(0, 1)}
                  </button>
                </>
              ) : (
                <>
                  <div className="header-back-slot" ref={setHeaderBack} />
                  <button className="m3-icon-button header-back-fallback" aria-label="返回" onClick={() => back()}>
                    <CanonicalIcon
                      name={backIconRotated ? "arrow" : "back"}
                      size={backIconSize}
                      style={backIconRotated ? { transform: "rotate(180deg)" } : undefined}
                    />
                  </button>
                  <div className="app-heading">
                    <div className="header-feature-title" ref={setHeaderTitle} />
                    <h1 className="header-title-fallback">{pageTitles[page] ?? "OpenOceanAcoustic"}</h1>
                  </div>
                  <div className="header-actions-group">
                    <div className="header-feature-actions m3-bar-actions" ref={setHeaderActions} />
                    {![
                      "issue",
                      "tasks",
                      "project-overview",
                      "finance",
                      "analytics",
                      "bounties",
                      "archived-tasks",
                    ].includes(page) && (
                      <button
                        className="m3-icon-button"
                        aria-label={route.projectId ? "项目导航" : "工作台"}
                        onClick={() => {
                          if (route.projectId) setProjectMenu(true);
                          else if (page !== "more") navigate({ page: "more" });
                          else setWorkspacePicker(true);
                        }}
                      >
                        <CanonicalIcon name="grid" size={variant === "personal" ? 20 : 22} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </header>
            {!online && (
              <p className="network-status" role="status">
                网络已断开
              </p>
            )}
            {notice && (
              <button className="network-status" role="status" onClick={() => setNotice("")}>
                {notice}
              </button>
            )}
            <main
              className="page"
              key={`${store.workspaceSlug}:${page}:${route.projectId}:${route.issueId}:${route.pageId}`}
            >
              <ErrorMessage error={error} />
              {store.user && !store.workspaceSlug && !["settings", "more", "space"].includes(page) ? (
                <>
                  <ErrorMessage error={workspaces.error} />
                  <p className="empty">暂无工作区</p>
                  <button className="button" onClick={() => setNewWorkspace(true)}>
                    创建工作区
                  </button>
                  <button className="button" onClick={() => navigate({ page: "settings" })}>
                    个人设置
                  </button>
                  <button className="button" onClick={() => navigate({ page: "space" })}>
                    共享页面
                  </button>
                </>
              ) : (
                content
              )}
            </main>
          </div>
          <div className="fab-mount" ref={setFab} />
          <div className="composer-mount" ref={setComposer} />
          <nav className="bottom-nav" aria-label="主导航">
            {(
              [
                ["home", "首页", "home"],
                ["inbox", "收件箱", "inbox"],
                ["search", "搜索", "search"],
              ] as const
            ).map(([target, label, icon]) => {
              const active = page === target;
              return (
                <button
                  key={target}
                  className={`nav-item${active ? " active" : ""}`}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  onClick={() => rootLink(target)}
                >
                  <span className="nav-icon">
                    <CanonicalIcon name={icon} size={22} />
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
          {projectMenu && (
            <Sheet title="项目导航" onClose={() => setProjectMenu(false)}>
              <div className="list">
                {projectLinks.map(([target, label]) => (
                  <button
                    className="row"
                    key={target}
                    onClick={() => {
                      setProjectMenu(false);
                      navigate({ page: target, projectId: route.projectId });
                    }}
                  >
                    <span className="row-main">{label}</span>
                    <CanonicalIcon name="arrow" size={16} />
                  </button>
                ))}
              </div>
            </Sheet>
          )}
          {workspacePicker && (
            <Sheet title="工作区" onClose={() => setWorkspacePicker(false)}>
              <div className="list">
                {records(workspaces.data).map((item) => (
                  <button
                    className="row"
                    key={item.id}
                    onClick={() => {
                      setWorkspacePicker(false);
                      requestMobileNavigation(() => {
                        store.setWorkspace(String(item.slug));
                        localStorage.setItem("ooa.workspace", String(item.slug));
                      });
                    }}
                  >
                    {String(item.name)}
                  </button>
                ))}
                <button
                  className="button"
                  onClick={() => {
                    setWorkspacePicker(false);
                    requestMobileNavigation(() => setNewWorkspace(true));
                  }}
                >
                  创建工作区
                </button>
              </div>
            </Sheet>
          )}
          {newWorkspace && (
            <FormSheet
              title="创建工作区"
              fields={[
                { key: "name", label: "名称", required: true },
                { key: "slug", label: "标识", required: true },
              ]}
              onClose={() => setNewWorkspace(false)}
              onSubmit={async (values) => {
                const created = await client.request<{ slug: string }>("/api/workspaces/", "POST", values);
                store.setWorkspace(created.slug);
                await workspaces.refresh();
              }}
            />
          )}
        </div>
      </MobileHeaderContext.Provider>
    </MobileClientContext.Provider>
  );
});
export default function MobileApp() {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <App />
    </SWRConfig>
  );
}
