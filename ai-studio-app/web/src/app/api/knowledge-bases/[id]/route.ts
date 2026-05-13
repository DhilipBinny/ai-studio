import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { knowledgeBases, documents } from "@ais-app/database";
import { updateKnowledgeBaseSchema } from "@ais-app/validation";
import { eq, and, count } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("KNOWLEDGE", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("KB ID required", "MISSING_ID", 400);

  const db = getDb();
  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.tenantId, auth.tenantId)))
    .limit(1);

  if (!kb) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  const [{ docCount }] = await db
    .select({ docCount: count() })
    .from(documents)
    .where(and(eq(documents.knowledgeBaseId, id), eq(documents.tenantId, auth.tenantId)));

  return NextResponse.json({ ...kb, documentCount: docCount });
});

export const PATCH = withRBAC("KNOWLEDGE", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("KB ID required", "MISSING_ID", 400);

  const body = await request.json();
  const parsed = updateKnowledgeBaseSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });

  const db = getDb();
  const [existing] = await db
    .select({ id: knowledgeBases.id })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.tenantId, auth.tenantId), eq(knowledgeBases.isActive, true)))
    .limit(1);

  if (!existing) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  if (parsed.data.name) {
    const [dup] = await db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(and(
        eq(knowledgeBases.tenantId, auth.tenantId),
        eq(knowledgeBases.name, parsed.data.name),
        eq(knowledgeBases.isActive, true),
      ))
      .limit(1);
    if (dup && dup.id !== id) return errorResponse("Name already exists", "NAME_EXISTS", 409);
  }

  const [updated] = await db
    .update(knowledgeBases)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.tenantId, auth.tenantId)))
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "knowledge_base.update",
    resourceType: "knowledge_base",
    resourceId: id,
    details: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json(updated);
});

export const DELETE = withRBAC("KNOWLEDGE", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("KB ID required", "MISSING_ID", 400);

  const db = getDb();
  const [kb] = await db
    .select({ id: knowledgeBases.id, name: knowledgeBases.name })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.tenantId, auth.tenantId)))
    .limit(1);

  if (!kb) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  await db
    .update(knowledgeBases)
    .set({ isActive: false, deactivatedAt: new Date(), updatedAt: new Date() })
    .where(eq(knowledgeBases.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "knowledge_base.delete",
    resourceType: "knowledge_base",
    resourceId: id,
    details: { name: kb.name },
  });

  return NextResponse.json({ success: true });
});
