import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents } from "@ais-app/database";
import { createAgentSchema, paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc, ilike } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("AGENTS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  const conditions = [eq(agents.tenantId, auth.tenantId), eq(agents.isActive, true)];
  if (status) conditions.push(eq(agents.status, status as typeof agents.status.enumValues[number]));
  if (search) conditions.push(ilike(agents.name, `%${search}%`));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: agents.id, name: agents.name, slug: agents.slug, description: agents.description,
      status: agents.status, version: agents.version, tags: agents.tags, createdAt: agents.createdAt,
    }).from(agents).where(where).orderBy(desc(agents.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(agents).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});

export const POST = withRBAC("AGENTS", 20, async (request, auth) => {
  const body = await request.json();
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });

  const db = getDb();

  const [existing] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.tenantId, auth.tenantId), eq(agents.slug, parsed.data.slug))).limit(1);
  if (existing) return errorResponse("Agent slug already exists", "SLUG_EXISTS", 409);

  const [agent] = await db.insert(agents).values({
    tenantId: auth.tenantId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description || "",
    systemPrompt: parsed.data.systemPrompt || "",
    rules: parsed.data.rules || [],
    providerModelId: parsed.data.providerModelId || null,
    temperature: parsed.data.temperature?.toString() || "0.7",
    maxTurns: parsed.data.maxTurns || 25,
    maxTokensPerTurn: parsed.data.maxTokensPerTurn || 4096,
    tags: parsed.data.tags || [],
    createdBy: auth.userId,
  }).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "agent.create", resourceType: "agent", resourceId: agent.id, details: { name: parsed.data.name, slug: parsed.data.slug } });

  return NextResponse.json(agent, { status: 201 });
});
