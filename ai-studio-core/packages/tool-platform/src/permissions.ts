import type { ToolPermissionLevel } from '@ais/types';

export type PermissionChecker = (
  tenantId: string,
  userRole: string,
  toolName: string,
) => Promise<ToolPermissionLevel | 'no_rule'>;

export async function checkToolPermission(
  toolName: string,
  userRole: string,
  tenantId: string,
  elevated: boolean,
  checker: PermissionChecker,
): Promise<ToolPermissionLevel> {
  if (userRole === 'admin') return 'allow';

  const permission = await checker(tenantId, userRole, toolName);

  if (permission === 'power_user') {
    return elevated ? 'allow' : 'deny';
  }

  if (permission === 'no_rule') {
    return userRole === 'viewer' ? 'deny' : 'allow';
  }

  return permission;
}
