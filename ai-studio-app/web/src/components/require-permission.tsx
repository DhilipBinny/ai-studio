"use client";

import { useAuth, type Module } from "@/lib/auth-context";
import { AccessDenied } from "@/components/access-denied";
import { Loader2 } from "lucide-react";

interface RequirePermissionProps {
  module: Module;
  level?: 10 | 20;
  children: React.ReactNode;
}

export function RequirePermission({ module, level = 10, children }: RequirePermissionProps) {
  const { user, loading, canView, canManage } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </div>
    );
  }

  const hasAccess = level >= 20 ? canManage(module) : canView(module);

  if (!user || !hasAccess) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
