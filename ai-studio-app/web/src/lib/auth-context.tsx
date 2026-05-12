"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Module =
  | "DASHBOARD" | "AGENTS" | "TOOLS" | "KNOWLEDGE" | "WORKFLOWS"
  | "CONNECTORS" | "RUNS" | "PROVIDERS" | "USERS" | "PROFILES"
  | "AUDIT" | "SETTINGS";

type PermissionLevel = 0 | 10 | 20;
type AccessRights = Record<Module, PermissionLevel>;

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  accessRights: AccessRights;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  canView: (module: Module) => boolean;
  canManage: (module: Module) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  canView: () => false,
  canManage: () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setUser({
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            role: data.user.role,
            accessRights: data.user.accessRights || {},
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function canView(module: Module): boolean {
    if (!user) return false;
    return (user.accessRights[module] ?? 0) >= 10;
  }

  function canManage(module: Module): boolean {
    if (!user) return false;
    return (user.accessRights[module] ?? 0) >= 20;
  }

  return (
    <AuthContext.Provider value={{ user, loading, canView, canManage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export type { Module, AccessRights, AuthUser };
