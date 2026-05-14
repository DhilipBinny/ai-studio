export { MODULES, MODULE_IDS, SECTION_LABELS, type Module, type Section } from "./modules";
export { SYSTEM_CONFIG_SCHEMA, getConfigDefaults, validateConfigValue, type ConfigFieldDef, type ConfigSectionDef } from "./system-config-schema";

import type { Module } from "./modules";

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
