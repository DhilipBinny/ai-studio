export const MODULES = [
  { id: "DASHBOARD",  label: "Dashboard",       section: "main",    href: "/dashboard" },
  { id: "AGENTS",     label: "Agents",           section: "build",   href: "/agents" },
  { id: "TOOLS",      label: "Tools",            section: "build",   href: "/tools" },
  { id: "KNOWLEDGE",  label: "Knowledge Bases",  section: "build",   href: "/knowledge" },
  { id: "WORKFLOWS",  label: "Workflows",        section: "build",   href: "/workflows" },
  { id: "RUNS",       label: "Runs",             section: "operate", href: "/runs" },
  { id: "CONNECTORS", label: "Connectors",       section: "operate", href: "/connectors" },
  { id: "PROVIDERS",  label: "Providers",        section: "operate", href: "/providers" },
  { id: "USERS",      label: "Users",            section: "admin",   href: "/users" },
  { id: "PROFILES",   label: "Profiles",         section: "admin",   href: "/settings" },
  { id: "AUDIT",      label: "Audit Log",        section: "admin",   href: "/settings" },
  { id: "SETTINGS",   label: "Settings",         section: "admin",   href: "/settings" },
] as const;

export type Module = typeof MODULES[number]["id"];
export type Section = typeof MODULES[number]["section"];

export const MODULE_IDS = MODULES.map((m) => m.id);
export const SECTION_LABELS: Record<Section, string> = {
  main: "",
  build: "Build",
  operate: "Operate",
  admin: "Admin",
};
