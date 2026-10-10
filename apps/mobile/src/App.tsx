import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { SWRConfig, useSWRConfig } from "swr";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import {
  Boxes,
  ChevronDown,
  ChevronLeft,
  Home as HomeIcon,
  Inbox as InboxIcon,
  Search as SearchIcon,
  Settings,
} from "lucide-react";
import { MobileStore, type MobileRoute, type MobileUser } from "@plane/shared-state/mobile";
import { ApiClient, nativeTransport } from "./lib/client";
import { ErrorMessage, FormSheet, Loading, Sheet, records, useData } from "./components/ui";
import { MobileClientContext } from "./components/rich-editor";
import { Login, ServerSetup } from "./features/auth";
import { Home, Inbox, SearchPage } from "./features/home";
import LabFeature from "./features/lab";
import CoreFeature from "./features/core";
import { SettingsFeature } from "./features/settings";
import Documents from "./features/documents";
import Space from "./features/space";
import WorkspaceFeature from "./features/workspace";
import type { MobileTheme } from "./features/settings/preferences";

const store = new MobileStore();
const initialServer = localStorage.getItem("ooa.server") ?? "";
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
  const navigate = useCallback((route: MobileRoute) => store.navigate(route), []);
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
      await Promise.allSettled([
        client.request("/auth/sign-out/", "POST"),
        client.request("/api/instances/admins/sign-out/", "POST"),
      ]);
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
        const event = new Event("mobileBack", { cancelable: true });
        window.dispatchEvent(event);
        if (!event.defaultPrevented && !store.back()) void NativeApp.minimizeApp();
      }),
      NativeApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          void mutate(() => true);
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
  }, [mutate]);
  useEffect(() => {
    const saved = localStorage.getItem("ooa.theme");
    if (["light", "dark", "system", "custom"].includes(saved ?? "")) store.setTheme(saved as MobileTheme["theme"]);
  }, []);
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
        ["--ink", customTheme.text],
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
  const selectedWorkspace = records(workspaces.data).find((item) => item.slug === store.workspaceSlug);
  if (setup) return <ServerSetup initial={server} onConnect={switchServer} />;
  if (loading)
    return (
      <main className="auth-page">
        <Loading />
      </main>
    );
  if (!store.user && route.page !== "admin" && route.page !== "space")
    return (
      <Login
        client={client}
        onLogin={restore}
        onServerChange={() => setSetup(true)}
        onAdmin={() => navigate({ page: "admin" })}
        onSpace={() => navigate({ page: "space" })}
      />
    );
  const page = route.page;
  const rootLink = (target: string) => store.root(target);
  let content;
  if (page === "home") content = <Home client={client} workspaceSlug={store.workspaceSlug} navigate={navigate} />;
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
  else
    content = (
      <SettingsFeature
        section={
          page === "admin"
            ? "admin"
            : page === "workspace-settings"
              ? "workspace"
              : page === "project-settings"
                ? "project"
                : "personal"
        }
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
  return (
    <MobileClientContext.Provider value={client}>
      <div className="app-shell" key={epoch}>
        <header className="topbar">
          {store.routes.length > 1 ? (
            <button
              className="icon-button"
              aria-label="返回"
              onClick={() => {
                const event = new Event("mobileBack", { cancelable: true });
                window.dispatchEvent(event);
                if (!event.defaultPrevented) store.back();
              }}
            >
              <ChevronLeft />
            </button>
          ) : (
            <div className="workspace-logo">{String(selectedWorkspace?.name ?? "O").slice(0, 1)}</div>
          )}
          <button className="workspace-switch" onClick={() => setWorkspacePicker(true)}>
            <span className="workspace-title">{String(selectedWorkspace?.name ?? "OpenOceanAcoustic")}</span>
            <ChevronDown size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="工作区设置"
            onClick={() => navigate({ page: "workspace-settings" })}
          >
            <Boxes />
          </button>
          <button className="avatar" aria-label="个人设置" onClick={() => navigate({ page: "settings" })}>
            {(store.user?.display_name ?? store.user?.username ?? "O").slice(0, 2)}
          </button>
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
          {route.projectId && page !== "issue" && (
            <nav className="project-navigation">
              {[
                ["project-overview", "概览"],
                ["tasks", "工作项"],
                ["documents", "文档"],
                ["cycles", "周期"],
                ["modules", "模块"],
                ["views", "视图"],
                ["intake", "需求收集"],
                ["archived-tasks", "归档"],
                ["project-settings", "设置"],
              ].map(([target, label]) => (
                <button
                  key={target}
                  onClick={() => navigate({ page: target, projectId: route.projectId })}
                  className={page === target ? "chip active" : "chip"}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          {store.user && !store.workspaceSlug ? (
            <>
              <ErrorMessage error={workspaces.error} />
              <p className="empty">暂无工作区</p>
              <button className="button" onClick={() => setNewWorkspace(true)}>
                创建工作区
              </button>
            </>
          ) : (
            content
          )}
          {page === "settings" && (
            <div className="list">
              <button className="button" onClick={() => navigate({ page: "workspace-settings" })}>
                <Settings size={18} />
                工作区设置
              </button>
              <button className="button" onClick={() => navigate({ page: "admin" })}>
                God Mode
              </button>
            </div>
          )}
        </main>
        <nav className="bottom-dock" aria-label="主导航">
          {[
            ["home", "首页", HomeIcon],
            ["inbox", "收件箱", InboxIcon],
            ["search", "搜索", SearchIcon],
          ].map(([target, label, Icon]) => {
            const Glyph = Icon as typeof HomeIcon;
            return (
              <button
                key={String(target)}
                className={page === target ? "active" : ""}
                aria-label={String(label)}
                aria-current={page === target ? "page" : undefined}
                onClick={() => rootLink(String(target))}
              >
                <Glyph size={25} />
              </button>
            );
          })}
        </nav>
        {workspacePicker && (
          <Sheet title="工作区" onClose={() => setWorkspacePicker(false)}>
            <div className="list">
              {records(workspaces.data).map((item) => (
                <button
                  className="row"
                  key={item.id}
                  onClick={() => {
                    store.setWorkspace(String(item.slug));
                    localStorage.setItem("ooa.workspace", String(item.slug));
                    setWorkspacePicker(false);
                  }}
                >
                  {String(item.name)}
                </button>
              ))}
              <button
                className="button"
                onClick={() => {
                  setWorkspacePicker(false);
                  setNewWorkspace(true);
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
