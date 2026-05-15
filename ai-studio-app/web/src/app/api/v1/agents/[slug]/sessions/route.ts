import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { runSession } from "@ais-app/agent-runtime";
import { authenticateApiKey, errorJson } from "@/lib/api-key-auth";
import { parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return errorJson("Invalid or missing API key", "UNAUTHORIZED", 401);

  const { slug } = await context.params;
  const db = getDb();

  const [agent] = await db
    .select({ id: agents.id, name: agents.name, status: agents.status })
    .from(agents)
    .where(and(eq(agents.slug, slug), eq(agents.tenantId, auth.tenantId), eq(agents.isActive, true)))
    .limit(1);

  if (!agent) return errorJson("Agent not found", "NOT_FOUND", 404);
  if (agent.status !== "active") return errorJson("Agent is not active", "AGENT_INACTIVE", 400);

  if (auth.scopedAgentIds.length > 0 && !auth.scopedAgentIds.includes(agent.id)) {
    return errorJson("API key does not have access to this agent", "FORBIDDEN", 403);
  }

  const body = await parseJsonBody(request);
  if (!body) return errorJson("Invalid JSON body", "INVALID_JSON", 400);
  const message = body.message;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return errorJson("Message is required", "VALIDATION_ERROR", 400);
  }

  const result = await runSession({
    agentId: agent.id,
    tenantId: auth.tenantId,
    userId: auth.keyId,
    message: message.trim(),
    channel: "api",
    metadata: { apiKeyName: auth.keyName, ...(body.metadata || {}) },
  });

  if (result.error) {
    return errorJson(result.error, "SESSION_ERROR", 400);
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: null,
    action: "api.session_create",
    resourceType: "agent_session",
    resourceId: result.sessionId,
    details: { agentSlug: slug, apiKey: auth.keyName, channel: "api" },
  });

  return NextResponse.json({
    sessionId: result.sessionId,
    response: { text: result.response, usage: result.usage },
    status: result.status,
  }, { status: 201 });
}
