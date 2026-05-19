import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { invalidateConfigCache } from "@ais-app/agent-runtime";
import {
  getSettings,
  updateSettings,
  ValidationError,
} from "@/lib/services/settings";

const updateSettingsSchema = z.object({
  entries: z.array(z.object({ key: z.string(), value: z.unknown() })).transform(
    (arr) => arr.map((e) => ({ key: e.key, value: e.value as unknown }))
  ),
});

export const GET = withRBAC("SETTINGS", 10, async (_request, auth) => {
  const result = await getSettings(auth.tenantId);
  return NextResponse.json(result);
});

export const PATCH = withRBAC("SETTINGS", 20, async (request, auth) => {
  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, {
      errors: parsed.error.flatten(),
    });
  }
  const entries = parsed.data.entries;

  try {
    const result = await updateSettings(auth.tenantId, entries, auth.userId);
    if (entries.some((e) => e.key === "agent_runtime")) invalidateConfigCache();
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
