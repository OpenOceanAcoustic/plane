import { makeAutoObservable } from "mobx";

export type MobileRoute = { page: string; projectId?: string; issueId?: string; pageId?: string; id?: string };
export type MobileUser = { id: string; username: string; display_name?: string; email?: string };
export class MobileStore {
  user: MobileUser | null = null;
  workspaceSlug = "";
  routes: MobileRoute[] = [{ page: "home" }];
  theme: "light" | "dark" | "system" | "custom" = "system";
  refreshKey = 0;
  constructor() {
    makeAutoObservable(this);
  }
  get route(): MobileRoute {
    return this.routes[this.routes.length - 1];
  }
  navigate(route: MobileRoute) {
    this.routes.push(route);
  }
  root(page = "home") {
    this.routes = [{ page }];
  }
  back(): boolean {
    if (this.routes.length > 1) {
      this.routes.pop();
      return true;
    }
    return false;
  }
  setUser(user: MobileUser | null) {
    this.user = user;
  }
  setWorkspace(slug: string) {
    this.workspaceSlug = slug;
    this.root();
    this.refresh();
  }
  setTheme(theme: "light" | "dark" | "system" | "custom") {
    this.theme = theme;
  }
  refresh() {
    this.refreshKey++;
  }
  reset() {
    this.user = null;
    this.workspaceSlug = "";
    this.root();
    this.refresh();
  }
}
