import { createContext, type SVGProps } from "react";

const paths = {
  plan: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4m8-4v4M3 10h18m-13 4h3m-3 3h6"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2Z"/>',
  work: '<rect x="9" y="3" width="12" height="12" rx="3" fill="currentColor" stroke="none" opacity=".75"/><rect x="3" y="9" width="12" height="12" rx="3" fill="currentColor" stroke="none"/>',
  workItems: '<path d="m4 8 9-5v12l-9 5Zm4 2 9-5v12l-9 5m4-10 9-5v12l-9 5"/>',
  market: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8m-8 4h6"/>',
  finance: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-5 4h5m-5 3h5"/>',
  analytics: '<path d="M4 3v18h18M8 16v-4m5 4V8m5 8V5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  home: '<path d="m12 2 10 8v11h-7v-7H9v7H2V10Z" fill="currentColor" stroke="none"/>',
  tray: '<path d="M6 4h12l3 8h-6l-1 3h-4l-1-3H3Zm-3 9h5l1 3h6l1-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill="currentColor" stroke="none"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  apps: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M18 3v6m-3-3h6"/>',
  menu: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  priority: '<path d="M6 18v-5m6 5V9m6 9V5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1"/>',
  kanban:
    '<rect x="3" y="4" width="5" height="15" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  gantt: '<path d="M4 4v16m0-13h10m-5 5h12m-6 5h6"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  comment: '<path d="M21 15a3 3 0 0 1-3 3h-7l-5 4v-4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z"/>',
  filter: '<path d="M3 5h18M6 11h12m-9 6h6"/>',
  up: '<path d="M12 21V3m-6 6 6-6 6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  edit: '<path d="m15 4 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
  link: '<path d="m9 15 6-6m-6-4 2-2a5 5 0 0 1 7 7l-2 2m-1 7-2 2a5 5 0 0 1-7-7l2-2"/>',
  wave: '<path d="M2 12h3l3-7 4 14 4-14 3 7h3"/>',
} as const;

export type CanonicalIconName = keyof typeof paths;
export function CanonicalIcon({
  name,
  size = 20,
  ...props
}: SVGProps<SVGSVGElement> & { name: CanonicalIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
      dangerouslySetInnerHTML={{ __html: paths[name] }}
    />
  );
}

export const MobileHeaderContext = createContext<{
  title: HTMLElement | null;
  actions: HTMLElement | null;
  back: HTMLElement | null;
  detail: boolean;
  composer: HTMLElement | null;
  fab: HTMLElement | null;
} | null>(null);
