import { NextRequest, NextResponse } from "next/server";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import {
  getSettings,
  updateSettings,
  ValidationError,
} from "@/lib/services/settings";

export const GET = withRBAC("SETTINGS", 10, async (_request, auth) => {
  const result = await getSettings(auth.tenantId);
  return NextResponse.json(result);
});

export const PATCH = withRBAC("SETTINGS", 20, async (request, auth) => {
  const body = await request.json();
  const entries = body.entries as Array<{ key: string; value: unknown }>;

  try {
    const result = await updateSettings(auth.tenantId, entries, auth.userId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ValidationError) {
      return errorResponse(e.message, "VALIDATION_ERROR", 400, {
        errors: e.errors,
      });
    }
    throw e;
  }
});
