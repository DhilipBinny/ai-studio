import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { workflows } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("WORKFLOWS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const where = and(eq(workflows.tenantId, auth.tenantId), eq(workflows.isActive, true));

  const [data, [{ total }]] = await Promise.all([
    db.select().from(workflows).where(where).orderBy(desc(workflows.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(workflows).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});

export const POST = withRBAC("WORKFLOWS", 20, async (request, auth) => {
  const body = await request.json();
  const { name, description, triggerConfig } = body;
  if (!name) return errorResponse("Name required", "VALIDATION_ERROR", 400);

  const db = getDb();
  const [existing] = await db.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.tenantId, auth.tenantId), eq(workflows.name, name))).limit(1);
  if (existing) return errorResponse("Name already exists", "NAME_EXISTS", 409);

  const [workflow] = await db.insert(workflows).values({
    tenantId: auth.tenantId,
    name,
    description: description || "",
    triggerConfig: triggerConfig || { type: "manual" },
    createdBy: auth.userId,
  }).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "workflow.create", resourceType: "workflow", resourceId: workflow.id, details: { name } });

  return NextResponse.json(workflow, { status: 201 });
});
