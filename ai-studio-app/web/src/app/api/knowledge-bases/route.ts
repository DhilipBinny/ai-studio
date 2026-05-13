import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { knowledgeBases } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("KNOWLEDGE", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const where = and(eq(knowledgeBases.tenantId, auth.tenantId), eq(knowledgeBases.isActive, true));

  const [data, [{ total }]] = await Promise.all([
    db.select().from(knowledgeBases).where(where).orderBy(desc(knowledgeBases.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(knowledgeBases).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});

export const POST = withRBAC("KNOWLEDGE", 20, async (request, auth) => {
  const body = await request.json();
  const { name, description, embeddingSource, embeddingProviderId, embeddingModel, embeddingDimension, rerankSource, rerankProviderId, rerankModel, chunkConfig } = body;
  if (!name) return errorResponse("Name required", "VALIDATION_ERROR", 400);

  const db = getDb();
  const [existing] = await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(and(eq(knowledgeBases.tenantId, auth.tenantId), eq(knowledgeBases.name, name))).limit(1);
  if (existing) return errorResponse("Name already exists", "NAME_EXISTS", 409);

  const source = embeddingSource || "builtin";
  const [kb] = await db.insert(knowledgeBases).values({
    tenantId: auth.tenantId,
    name,
    description: description || "",
    embeddingSource: source,
    embeddingProviderId: source === "provider" ? embeddingProviderId : null,
    embeddingModel: embeddingModel || (source === "builtin" ? "Xenova/bge-small-en-v1.5" : "text-embedding-3-small"),
    embeddingDimension: embeddingDimension || (source === "builtin" ? 384 : 1536),
    rerankSource: rerankSource || null,
    rerankProviderId: rerankSource === "provider" ? rerankProviderId : null,
    rerankModel: rerankModel || null,
    chunkConfig: chunkConfig || { method: "recursive", chunk_size: 2048, chunk_overlap: 200 },
    createdBy: auth.userId,
  }).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "knowledge_base.create", resourceType: "knowledge_base", resourceId: kb.id, details: { name } });

  return NextResponse.json(kb, { status: 201 });
});
