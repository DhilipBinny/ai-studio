export const MODULES = [
  { id: "DASHBOARD",  label: "Dashboard",       section: "main",    href: "/dashboard" },
  { id: "AGENTS",     label: "Agents",           section: "build",   href: "/agents" },
  { id: "TOOLS",      label: "Tools",            section: "build",   href: "/tools" },
  { id: "KNOWLEDGE",  label: "Knowledge Bases",  section: "build",   href: "/knowledge" },
  { id: "WORKFLOWS",  label: "Workflows",        section: "build",   href: "/workflows" },
  { id: "RUNS",       label: "Sessions",          section: "operate", href: "/runs" },
  { id: "SCHEDULED",  label: "Scheduled Jobs",   section: "operate", href: "/scheduled" },
  { id: "CONNECTORS", label: "Connectors",       section: "operate", href: "/connectors" },
  { id: "PROVIDERS",  label: "Providers",        section: "operate", href: "/providers" },
  { id: "USERS",      label: "Users",            section: "admin",   href: "/users" },
  { id: "AUDIT",      label: "Audit Log",        section: "admin",   href: "/audit-log" },
  { id: "SETTINGS",   label: "Settings",         section: "admin",   href: "/settings" },
  { id: "PROFILES",   label: "Profiles",         section: "hidden",  href: "/settings" },
] as const;

export type Module = typeof MODULES[number]["id"];
export type Section = typeof MODULES[number]["section"];

export const MODULE_IDS = MODULES.map((m) => m.id);
export const SECTION_LABELS: Record<Section, string> = {
  main: "",
  build: "Build",
  operate: "Operate",
  admin: "Admin",
  hidden: "",
};
