import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { tools } from "@ais-app/database";
import { createToolSchema, paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc, ilike } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("TOOLS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const toolType = url.searchParams.get("type");
  const category = url.searchParams.get("category");

  const conditions = [eq(tools.tenantId, auth.tenantId), eq(tools.isActive, true)];
  if (toolType) conditions.push(eq(tools.toolType, toolType as typeof tools.toolType.enumValues[number]));
  if (category) conditions.push(eq(tools.category, category));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db.select().from(tools).where(where).orderBy(desc(tools.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(tools).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});

export const POST = withRBAC("TOOLS", 20, async (request, auth) => {
  const body = await request.json();
  const parsed = createToolSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });

  const db = getDb();

  const [existing] = await db.select({ id: tools.id }).from(tools).where(and(eq(tools.tenantId, auth.tenantId), eq(tools.name, parsed.data.name))).limit(1);
  if (existing) return errorResponse("Tool name already exists", "NAME_EXISTS", 409);

  const [tool] = await db.insert(tools).values({
    tenantId: auth.tenantId,
    name: parsed.data.name,
    displayName: parsed.data.displayName,
    description: parsed.data.description || "",
    toolType: parsed.data.toolType,
    category: parsed.data.category || "general",
    parametersSchema: parsed.data.parametersSchema || {},
    returnsSchema: parsed.data.returnsSchema || {},
    config: parsed.data.config || {},
    createdBy: auth.userId,
  }).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "tool.create", resourceType: "tool", resourceId: tool.id, details: { name: parsed.data.name } });

  return NextResponse.json(tool, { status: 201 });
});
