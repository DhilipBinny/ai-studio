"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Bot,
  Wrench,
  BookOpen,
  GitBranch,
  Plug,
  Play,
  Server,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Users,
} from "lucide-react";

const mainNav = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
];

const buildNav = [
  { name: "Agents", href: "/agents", icon: Bot },
  { name: "Tools", href: "/tools", icon: Wrench },
  { name: "Knowledge Bases", href: "/knowledge", icon: BookOpen },
  { name: "Workflows", href: "/workflows", icon: GitBranch },
];

const operateNav = [
  { name: "Runs", href: "/runs", icon: Play },
  { name: "Connectors", href: "/connectors", icon: Plug },
  { name: "Providers", href: "/providers", icon: Server },
];

const adminNav = [
  { name: "Users", href: "/users", icon: Users },
  { name: "Settings", href: "/settings", icon: Settings },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function NavItem({ item, collapsed, isActive }: { item: { name: string; href: string; icon: React.ComponentType<{ className?: string }> }; collapsed: boolean; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.name : undefined}
      className={cn(
        "flex items-center rounded-md text-sm font-medium transition-colors",
        collapsed ? "justify-center p-2" : "gap-3 px-3 py-2",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {!collapsed && item.name}
    </Link>
  );
}

function NavSection({ label, items, collapsed, pathname }: { label: string; items: typeof mainNav; collapsed: boolean; pathname: string }) {
  return (
    <div className="space-y-0.5">
      {!collapsed && label && (
        <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
      )}
      {collapsed && label && <div className="my-2 mx-2 border-t border-sidebar-border" />}
      {items.map((item) => (
        <NavItem
          key={item.href}
          item={item}
          collapsed={collapsed}
          isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
        />
      ))}
    </div>
  );
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
        collapsed ? "w-14" : "w-64"
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "gap-2.5 px-4")}>
        <img
          src="/branding/echol-icon.png"
          alt="Echol"
          className={cn("shrink-0 rounded-lg", collapsed ? "h-7 w-7" : "h-8 w-8")}
        />
        {!collapsed && (
          <span className="text-base font-semibold text-sidebar-foreground">AI Studio</span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <NavSection label="" items={mainNav} collapsed={collapsed} pathname={pathname} />
        <NavSection label="Build" items={buildNav} collapsed={collapsed} pathname={pathname} />
        <NavSection label="Operate" items={operateNav} collapsed={collapsed} pathname={pathname} />
        <NavSection label="Admin" items={adminNav} collapsed={collapsed} pathname={pathname} />
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className={cn(
            "w-full text-muted-foreground h-7",
            collapsed ? "justify-center px-0" : "justify-start gap-2.5 px-3"
          )}
        >
          {collapsed ? <PanelLeft className="h-3.5 w-3.5" /> : <><PanelLeftClose className="h-3.5 w-3.5" /> Collapse</>}
        </Button>
      </div>
    </aside>
  );
}
