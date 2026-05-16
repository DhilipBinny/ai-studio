import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@ais-app/auth";
import { hasPermission } from "@ais-app/auth";
import { getDb } from "@ais-app/database";
import { users, profiles, revokedTokens } from "@ais-app/database";
import { eq } from "drizzle-orm";
import type { Module, PermissionLevel, AccessRights, AuthContext } from "@ais-app/types";

/** Escape LIKE/ILIKE wildcards so user input is treated as literal text. */
export function escapeLike(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function errorResponse(
  error: string,
  code: string,
  status: number,
  details?: Record<string, unknown>
) {
  return NextResponse.json({ error, code, details }, { status });
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function getAuthContext(
  request: NextRequest
): Promise<AuthContext | null> {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;

  try {
    const payload = await verifyAccessToken(token);
    const db = getDb();

    if (payload.jti) {
      const [revoked] = await db
        .select({ id: revokedTokens.id })
        .from(revokedTokens)
        .where(eq(revokedTokens.jti, payload.jti))
        .limit(1);
      if (revoked) return null;
    }

    const [user] = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        profileId: users.profileId,
        role: users.role,
        isActive: users.isActive,
        isLocked: users.isLocked,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || !user.isActive || user.isLocked) return null;
    if (user.tenantId !== (payload.tid as string)) return null;

    let accessRights: AccessRights = {
      DASHBOARD: 0, AGENTS: 0, TOOLS: 0, KNOWLEDGE: 0, WORKFLOWS: 0,
      CONNECTORS: 0, RUNS: 0, SCHEDULED: 0, PROVIDERS: 0, WORKSPACE: 0, USERS: 0, PROFILES: 0,
      AUDIT: 0, SETTINGS: 0,
    };

    if (user.profileId) {
      const [profile] = await db
        .select({ accessRights: profiles.accessRights })
        .from(profiles)
        .where(eq(profiles.id, user.profileId))
        .limit(1);

      if (profile) {
        accessRights = profile.accessRights as AccessRights;
      }
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      profileId: user.profileId || "",
      role: user.role as AuthContext["role"],
      accessRights,
    };
  } catch {
    return null;
  }
}

type RouteHandler = (
  request: NextRequest,
  ctx: AuthContext,
  params?: Record<string, string>
) => Promise<NextResponse>;

export function withAuth(handler: RouteHandler) {
  return async (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ): Promise<NextResponse> => {
    const auth = await getAuthContext(request);
    if (!auth) {
      return errorResponse("Authentication required", "UNAUTHENTICATED", 401);
    }
    const params = await context.params;
    try {
      return await handler(request, auth, params);
    } catch (err) {
      console.error("Route handler error:", err);
      return errorResponse("Internal server error", "INTERNAL_ERROR", 500);
    }
  };
}

export function withRBAC(module: Module, level: PermissionLevel, handler: RouteHandler) {
  return withAuth(async (request, auth, params) => {
    if (!hasPermission(auth.accessRights, module, level)) {
      return errorResponse(
        `Insufficient permissions for ${module}`,
        "FORBIDDEN",
        403
      );
    }
    return handler(request, auth, params);
  });
}
