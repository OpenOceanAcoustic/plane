import { createContext, type SVGProps } from "react";

const paths = {
  plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  projects: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  work: '<rect x="9" y="3" width="12" height="12" rx="3" fill="currentColor" stroke="none" opacity=".75"/><rect x="3" y="9" width="12" height="12" rx="3" fill="currentColor" stroke="none"/>',
  workItems:
    '<path d="M14 3h6v6M14 9l6-6M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/><path d="m7 12 3 3 6-6"/>',
  market: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m7-7-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  finance:
    '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-4a2 2 0 0 0 0 4h4M17 14h.01"/>',
  analytics: '<path d="M4 3v18h17M8 16V9M13 16V5M18 16v-5"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  settings:
    '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  tray: '<path d="M3 13 6 4h12l3 9v7H3z"/><path d="M3 13h5l2 3h4l2-3h5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  menu: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  priority: '<path d="M6 18v-5m6 5V9m6 9V5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
  kanban:
    '<rect x="3" y="4" width="5" height="15" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  gantt: '<path d="M4 4v16m0-13h10m-5 5h12m-6 5h6"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z"/>',
  filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
  up: '<path d="M12 21V3m-6 6 6-6 6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6 12-12ZM14 5l5 5"/>',
  link: '<path d="m9 15 6-6m-6-4 2-2a5 5 0 0 1 7 7l-2 2m-1 7-2 2a5 5 0 0 1-7-7l2-2"/>',
  wave: '<path d="M2 12h3l3-7 4 14 4-14 3 7h3"/>',
  ocean:
    '<path d="M3 8c2-3 4 3 6 0s4 3 6 0 4 3 6 0M3 13c2-3 4 3 6 0s4 3 6 0 4 3 6 0M3 18c2-3 4 3 6 0s4 3 6 0 4 3 6 0"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  task: '<path d="M14 3h6v6M14 9l6-6M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/><path d="m7 12 3 3 6-6"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  note: '<path d="M17 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l5-5V6a3 3 0 0 0-3-3Z"/><path d="M15 21v-5h5M8 8h8M8 12h6"/>',
  inbox: '<path d="M3 13 6 4h12l3 9v7H3z"/><path d="M3 13h5l2 3h4l2-3h5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  sort: '<path d="M4 6h16M4 12h11M4 18h6M18 14v7m-3-3 3 3 3-3"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M10 12h4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  wallet:
    '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-4a2 2 0 0 0 0 4h4M17 14h.01"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M4 3v18h17M8 16V9M13 16V5M18 16v-5"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3z"/><circle cx="12" cy="14" r="4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>',
  diamond: '<path d="m3 9 4-6h10l4 6-9 13Zm0 0h18M7 3l5 19 5-19"/>',
  activity: '<path d="M2 12h5l3-9 4 18 3-9h5"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9ZM2 13l10 6 10-6M2 17l10 6 10-6"/>',
  logout: '<path d="M9 4H4v16h5M10 12h11m-5-5 5 5-5 5"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  priorityUp: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
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
      strokeWidth={1.8}
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
  onBack: (fallback?: () => void) => void;
  variant: "home" | "project" | "personal" | "standard";
  backIconSize: number;
  backIconRotated: boolean;
  actions: HTMLElement | null;
  back: HTMLElement | null;
  detail: boolean;
  composer: HTMLElement | null;
  fab: HTMLElement | null;
} | null>(null);
