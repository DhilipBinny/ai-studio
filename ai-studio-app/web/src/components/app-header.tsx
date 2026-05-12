"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { LogOut, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export function AppHeader() {
  const { user } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <div />

      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setDropdownOpen((o) => !o); }}
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-brand">
            <User className="h-4 w-4" />
          </div>
          {user && (
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-none">{user.name}</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role] || user.role}</p>
            </div>
          )}
        </button>

        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-card p-1 shadow-md">
              {user && (
                <div className="px-3 py-2">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              )}
              <Separator />
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
