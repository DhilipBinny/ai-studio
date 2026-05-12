export type Module =
  | "DASHBOARD"
  | "AGENTS"
  | "TOOLS"
  | "KNOWLEDGE"
  | "WORKFLOWS"
  | "CONNECTORS"
  | "RUNS"
  | "PROVIDERS"
  | "USERS"
  | "PROFILES"
  | "AUDIT"
  | "SETTINGS";

export type PermissionLevel = 0 | 10 | 20;

export type AccessRights = Record<Module, PermissionLevel>;

export type UserRole = "super_admin" | "admin" | "member" | "viewer";

export interface JWTPayload {
  sub: string;
  tid: string;
  pid: string;
  rol: UserRole;
  arh: string;
  iat: number;
  exp: number;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  profileId: string;
  role: UserRole;
  accessRights: AccessRights;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}
