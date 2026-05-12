import type { AccessRights, Module, PermissionLevel } from "@ais-app/types";

export function hasPermission(
  rights: AccessRights,
  module: Module,
  requiredLevel: PermissionLevel
): boolean {
  const userLevel = rights[module] ?? 0;
  return userLevel >= requiredLevel;
}

export function canView(rights: AccessRights, module: Module): boolean {
  return hasPermission(rights, module, 10);
}

export function canManage(rights: AccessRights, module: Module): boolean {
  return hasPermission(rights, module, 20);
}
