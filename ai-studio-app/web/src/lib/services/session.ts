import { getDb } from "@ais-app/database";
import {
  agentSessions,
  agentSessionMessages,
  agentSessionToolCalls,
  agents,
  systemConfig,
} from "@ais-app/database";
import { eq, and, count, desc, asc } from "drizzle-orm";
import { createAuditEntry } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaginationOpts {
  page: number;
  pageSize: number;
}

interface GetSessionsOpts extends PaginationOpts {
  status?: string | null;
  agentId?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function getCostMarginFactor(tenantId: string): Promise<number> {
  const db = getDb();
  const billingRow = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(
      and(
        eq(systemConfig.tenantId, tenantId),
        eq(systemConfig.key, "billing"),
      ),
    )
    .limit(1);

  const billingSettings = (billingRow[0]?.value ?? {}) as Record<string, unknown>;
  const rawMargin = Number(billingSettings.cost_margin_factor);
  return isNaN(rawMargin) || rawMargin < 1 ? 1.0 : rawMargin;
}

// ---------------------------------------------------------------------------
// getSessions — paginated list with cost margin
// ---------------------------------------------------------------------------

export async function getSessions(tenantId: string, opts: GetSessionsOpts) {
  const db = getDb();

  const conditions = [eq(agentSessions.tenantId, tenantId)];
  if (opts.status)
    conditions.push(
      eq(
        agentSessions.status,
        opts.status as (typeof agentSessions.status.enumValues)[number],
      ),
    );
  if (opts.agentId) conditions.push(eq(agentSessions.agentId, opts.agentId));

  const where = and(...conditions);

  const [data, [{ total }], billingRow] = await Promise.all([
    db
      .select({
        id: agentSessions.id,
        agentId: agentSessions.agentId,
        agentName: agents.name,
        status: agentSessions.status,
        triggerType: agentSessions.triggerType,
        channel: agentSessions.channel,
        totalInputTokens: agentSessions.totalInputTokens,
        totalOutputTokens: agentSessions.totalOutputTokens,
        totalCostUsd: agentSessions.totalCostUsd,
        totalTurns: agentSessions.totalTurns,
        totalToolCalls: agentSessions.totalToolCalls,
        modelUsed: agentSessions.modelUsed,
        startedAt: agentSessions.startedAt,
        completedAt: agentSessions.completedAt,
        createdAt: agentSessions.createdAt,
      })
      .from(agentSessions)
      .innerJoin(agents, eq(agentSessions.agentId, agents.id))
      .where(where)
      .orderBy(desc(agentSessions.createdAt))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ total: count() }).from(agentSessions).where(where),
    db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(
        and(
          eq(systemConfig.tenantId, tenantId),
          eq(systemConfig.key, "billing"),
        ),
      )
      .limit(1),
  ]);

  const billingSettings = (billingRow[0]?.value ?? {}) as Record<string, unknown>;
  const rawMargin = Number(billingSettings.cost_margin_factor);
  const marginFactor = isNaN(rawMargin) || rawMargin < 1 ? 1.0 : rawMargin;

  const rows = data.map((s) => ({
    ...s,
    totalCostUsd: (Number(s.totalCostUsd || 0) * marginFactor).toFixed(6),
  }));

  return {
    data: rows,
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    totalPages: Math.ceil(total / opts.pageSize),
  };
}

// ---------------------------------------------------------------------------
// getSessionDetail — full session with messages, tools, margin
// ---------------------------------------------------------------------------

export async function getSessionDetail(tenantId: string, sessionId: string) {
  const db = getDb();

  const [row] = await db
    .select({
      id: agentSessions.id,
      agentId: agentSessions.agentId,
      agentName: agents.name,
      agentSlug: agents.slug,
      status: agentSessions.status,
      channel: agentSessions.channel,
      triggerType: agentSessions.triggerType,
      totalInputTokens: agentSessions.totalInputTokens,
      totalOutputTokens: agentSessions.totalOutputTokens,
      totalCostUsd: agentSessions.totalCostUsd,
      totalToolCalls: agentSessions.totalToolCalls,
      totalTurns: agentSessions.totalTurns,
      modelUsed: agentSessions.modelUsed,
      providerUsed: agentSessions.providerUsed,
      errorMessage: agentSessions.errorMessage,
      startedAt: agentSessions.startedAt,
      completedAt: agentSessions.completedAt,
      createdAt: agentSessions.createdAt,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(
      and(
        eq(agentSessions.id, sessionId),
        eq(agentSessions.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const [messages, toolCalls, billingRow] = await Promise.all([
    db
      .select()
      .from(agentSessionMessages)
      .where(and(eq(agentSessionMessages.agentSessionId, sessionId), eq(agentSessionMessages.tenantId, tenantId)))
      .orderBy(asc(agentSessionMessages.createdAt)),
    db
      .select()
      .from(agentSessionToolCalls)
      .where(and(eq(agentSessionToolCalls.agentSessionId, sessionId), eq(agentSessionToolCalls.tenantId, tenantId)))
      .orderBy(asc(agentSessionToolCalls.createdAt)),
    db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(
        and(
          eq(systemConfig.tenantId, tenantId),
          eq(systemConfig.key, "billing"),
        ),
      )
      .limit(1),
  ]);

  const billingSettings = (billingRow[0]?.value ?? {}) as Record<string, unknown>;
  const rawMargin = Number(billingSettings.cost_margin_factor);
  const marginFactor = isNaN(rawMargin) || rawMargin < 1 ? 1.0 : rawMargin;

  return {
    ...row,
    totalCostUsd: (Number(row.totalCostUsd || 0) * marginFactor).toFixed(6),
    messages,
    toolCalls,
  };
}

// ---------------------------------------------------------------------------
// approveToolCall — approval state machine
// ---------------------------------------------------------------------------

export async function approveToolCall(
  tenantId: string,
  sessionId: string,
  toolCallId: string,
  action: "approve" | "deny",
  userId: string,
) {
  const db = getDb();

  const [session] = await db
    .select({ id: agentSessions.id, status: agentSessions.status })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.id, sessionId),
        eq(agentSessions.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!session) throw new SessionNotFoundError();
  if (session.status !== "waiting_approval") {
    throw new InvalidStateError("Session is not waiting for approval");
  }

  const [toolCall] = await db
    .select({
      id: agentSessionToolCalls.id,
      toolName: agentSessionToolCalls.toolName,
      approvalStatus: agentSessionToolCalls.approvalStatus,
    })
    .from(agentSessionToolCalls)
    .where(
      and(
        eq(agentSessionToolCalls.id, Number(toolCallId)),
        eq(agentSessionToolCalls.agentSessionId, sessionId),
        eq(agentSessionToolCalls.tenantId, tenantId),
        eq(agentSessionToolCalls.requiresApproval, true),
      ),
    )
    .limit(1);

  if (!toolCall) {
    throw new ToolCallNotFoundError();
  }
  if (toolCall.approvalStatus) {
    throw new AlreadyDecidedError(
      `Tool call already ${toolCall.approvalStatus}`,
    );
  }

  await db
    .update(agentSessionToolCalls)
    .set({
      approvalStatus: action === "approve" ? "approved" : "denied",
      approvedBy: userId,
      approvedAt: new Date(),
      status: action === "approve" ? "pending" : "denied",
      result:
        action === "deny"
          ? "Denied by admin"
          : "Approved — will execute on next message",
    })
    .where(eq(agentSessionToolCalls.id, Number(toolCallId)));

  await db
    .update(agentSessions)
    .set({ status: action === "approve" ? "waiting" : "failed" })
    .where(eq(agentSessions.id, sessionId));

  await createAuditEntry({
    tenantId,
    userId,
    action: `session.tool_${action}`,
    resourceType: "agent_session",
    resourceId: sessionId,
    details: { toolCallId, toolName: toolCall.toolName, action },
  });

  return { success: true, action };
}

// ---------------------------------------------------------------------------
// cancelSession — cancel a running session
// ---------------------------------------------------------------------------

export async function cancelSession(
  tenantId: string,
  sessionId: string,
  userId: string,
) {
  const db = getDb();

  const [session] = await db
    .select({ id: agentSessions.id, status: agentSessions.status })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.id, sessionId),
        eq(agentSessions.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!session) throw new SessionNotFoundError();
  if (session.status !== "running" && session.status !== "pending") {
    throw new InvalidStateError("Session is not active");
  }

  await db
    .update(agentSessions)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(agentSessions.id, sessionId),
        eq(agentSessions.tenantId, tenantId),
      ),
    );

  await createAuditEntry({
    tenantId,
    userId,
    action: "session.cancel",
    resourceType: "agent_session",
    resourceId: sessionId,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class SessionNotFoundError extends Error {
  constructor() {
    super("Session not found");
    this.name = "SessionNotFoundError";
  }
}

export class ToolCallNotFoundError extends Error {
  constructor() {
    super("Tool call not found or does not require approval");
    this.name = "ToolCallNotFoundError";
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}

export class AlreadyDecidedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyDecidedError";
  }
}
