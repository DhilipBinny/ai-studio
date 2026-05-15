import { getDb } from "@ais-app/database";
import {
  agents,
  agentTools,
  tools,
  agentKnowledgeBases,
  knowledgeBases,
  agentConnectors,
  connectors,
} from "@ais-app/database";
import { eq, and, count, desc, ilike, sql } from "drizzle-orm";
import { escapeLike } from "@/lib/api-utils";
import { createAuditEntry } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaginationOpts {
  page: number;
  pageSize: number;
}

interface GetAgentsOpts extends PaginationOpts {
  status?: string | null;
  search?: string | null;
}

interface CreateAgentData {
  name: string;
  slug: string;
  description?: string;
  systemPrompt?: string;
  persona?: Record<string, unknown>;
  rules?: unknown[];
  providerModelId?: string | null;
  temperature?: number | null;
  maxTurns?: number;
  maxTokensPerTurn?: number;
  tags?: string[];
}

interface UpdateAgentData {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// getAgents — paginated list
// ---------------------------------------------------------------------------

export async function getAgents(tenantId: string, opts: GetAgentsOpts) {
  const db = getDb();

  const conditions = [eq(agents.tenantId, tenantId), eq(agents.isActive, true)];
  if (opts.status)
    conditions.push(
      eq(
        agents.status,
        opts.status as (typeof agents.status.enumValues)[number],
      ),
    );
  if (opts.search) conditions.push(ilike(agents.name, `%${escapeLike(opts.search)}%`));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        id: agents.id,
        name: agents.name,
        slug: agents.slug,
        description: agents.description,
        systemPrompt: agents.systemPrompt,
        persona: agents.persona,
        rules: agents.rules,
        providerModelId: agents.providerModelId,
        temperature: agents.temperature,
        maxTurns: agents.maxTurns,
        maxTokensPerTurn: agents.maxTokensPerTurn,
        status: agents.status,
        version: agents.version,
        tags: agents.tags,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(where)
      .orderBy(desc(agents.createdAt))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ total: count() }).from(agents).where(where),
  ]);

  return {
    data,
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    totalPages: Math.ceil(total / opts.pageSize),
  };
}

// ---------------------------------------------------------------------------
// getAgentDetail — full agent with tools/KBs/connectors
// ---------------------------------------------------------------------------

export async function getAgentDetail(tenantId: string, agentId: string) {
  const db = getDb();

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
    .limit(1);

  if (!agent) return null;

  const assignedTools = await db
    .select({
      id: agentTools.id,
      toolId: agentTools.toolId,
      toolConfig: agentTools.toolConfig,
      isRequired: agentTools.isRequired,
      priority: agentTools.priority,
      toolName: tools.name,
      toolDisplayName: tools.displayName,
    })
    .from(agentTools)
    .innerJoin(
      tools,
      and(eq(agentTools.toolId, tools.id), eq(tools.tenantId, tenantId)),
    )
    .where(and(eq(agentTools.agentId, agentId), eq(agentTools.tenantId, tenantId)));

  const assignedKBs = await db
    .select({
      id: agentKnowledgeBases.id,
      knowledgeBaseId: agentKnowledgeBases.knowledgeBaseId,
      searchConfig: agentKnowledgeBases.searchConfig,
      kbName: knowledgeBases.name,
    })
    .from(agentKnowledgeBases)
    .innerJoin(
      knowledgeBases,
      and(
        eq(agentKnowledgeBases.knowledgeBaseId, knowledgeBases.id),
        eq(knowledgeBases.tenantId, tenantId),
      ),
    )
    .where(and(eq(agentKnowledgeBases.agentId, agentId), eq(agentKnowledgeBases.tenantId, tenantId)));

  const assignedConnectors = await db
    .select({
      id: agentConnectors.id,
      connectorId: agentConnectors.connectorId,
      connectorName: connectors.name,
      connectorType: connectors.connectorType,
      status: connectors.status,
    })
    .from(agentConnectors)
    .innerJoin(
      connectors,
      and(eq(agentConnectors.connectorId, connectors.id), eq(connectors.tenantId, tenantId)),
    )
    .where(and(eq(agentConnectors.agentId, agentId), eq(agentConnectors.tenantId, tenantId)));

  return {
    ...agent,
    tools: assignedTools,
    knowledgeBases: assignedKBs,
    connectors: assignedConnectors,
  };
}

// ---------------------------------------------------------------------------
// createAgent — create with uniqueness check
// ---------------------------------------------------------------------------

export async function createAgent(
  tenantId: string,
  data: CreateAgentData,
  userId: string,
) {
  const db = getDb();

  let agent;
  try {
    [agent] = await db
      .insert(agents)
      .values({
        tenantId,
        name: data.name,
        slug: data.slug,
        description: data.description || "",
        systemPrompt: data.systemPrompt || "",
        persona: data.persona || {},
        rules: data.rules || [],
        providerModelId: data.providerModelId || null,
        temperature: data.temperature?.toString() || "0.7",
        maxTurns: data.maxTurns || 25,
        maxTokensPerTurn: data.maxTokensPerTurn || 4096,
        tags: data.tags || [],
        createdBy: userId,
      })
      .returning();
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      throw new SlugExistsError();
    }
    throw err;
  }

  await createAuditEntry({
    tenantId,
    userId,
    action: "agent.create",
    resourceType: "agent",
    resourceId: agent.id,
    details: { name: data.name, slug: data.slug },
  });

  return agent;
}

// ---------------------------------------------------------------------------
// updateAgent — update with version increment
// ---------------------------------------------------------------------------

export async function updateAgent(
  tenantId: string,
  agentId: string,
  data: UpdateAgentData,
  userId: string,
) {
  const db = getDb();

  const updateData: Record<string, unknown> = {
    version: sql`${agents.version} + 1`,
  };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      if (key === "temperature" && value != null) updateData[key] = String(value);
      else updateData[key] = value;
    }
  }

  const [updated] = await db
    .update(agents)
    .set(updateData)
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
    .returning();

  if (!updated) throw new AgentNotFoundError();

  await createAuditEntry({
    tenantId,
    userId,
    action: "agent.update",
    resourceType: "agent",
    resourceId: agentId,
    details: {
      fields: Object.keys(data),
      newVersion: updated.version,
    },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class AgentNotFoundError extends Error {
  constructor() {
    super("Agent not found");
    this.name = "AgentNotFoundError";
  }
}

export class SlugExistsError extends Error {
  constructor() {
    super("Agent slug already exists");
    this.name = "SlugExistsError";
  }
}
