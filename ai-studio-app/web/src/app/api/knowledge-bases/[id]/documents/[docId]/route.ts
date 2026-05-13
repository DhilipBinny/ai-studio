import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { knowledgeBases, documents, documentChunks } from "@ais-app/database";
import { eq, and, count } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { unlink } from "fs/promises";
import { join } from "path";

const UPLOAD_BASE = join(process.cwd(), "..", ".data", "uploads");

export const GET = withRBAC("KNOWLEDGE", 10, async (_request, auth, params) => {
  const { id: kbId, docId } = params || {};
  if (!kbId || !docId) return errorResponse("KB ID and Document ID required", "MISSING_ID", 400);

  const db = getDb();
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.knowledgeBaseId, kbId), eq(documents.tenantId, auth.tenantId)))
    .limit(1);

  if (!doc) return errorResponse("Document not found", "NOT_FOUND", 404);

  return NextResponse.json(doc);
});

export const DELETE = withRBAC("KNOWLEDGE", 20, async (_request, auth, params) => {
  const { id: kbId, docId } = params || {};
  if (!kbId || !docId) return errorResponse("KB ID and Document ID required", "MISSING_ID", 400);

  const db = getDb();
  const [doc] = await db
    .select({ id: documents.id, fileName: documents.fileName, storagePath: documents.storagePath })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.knowledgeBaseId, kbId), eq(documents.tenantId, auth.tenantId)))
    .limit(1);

  if (!doc) return errorResponse("Document not found", "NOT_FOUND", 404);

  await db.delete(documentChunks).where(eq(documentChunks.documentId, docId));
  await db.delete(documents).where(eq(documents.id, docId));

  try {
    await unlink(join(UPLOAD_BASE, doc.storagePath));
  } catch {
    // File may already be deleted — not critical
  }

  const [{ docCount }] = await db.select({ docCount: count() }).from(documents).where(eq(documents.knowledgeBaseId, kbId));
  const [{ chunkTotal }] = await db.select({ chunkTotal: count() }).from(documentChunks).where(and(
    eq(documentChunks.tenantId, auth.tenantId),
  ));

  await db
    .update(knowledgeBases)
    .set({ documentCount: docCount, updatedAt: new Date() })
    .where(eq(knowledgeBases.id, kbId));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "document.delete",
    resourceType: "document",
    resourceId: docId,
    details: { fileName: doc.fileName, knowledgeBaseId: kbId },
  });

  return NextResponse.json({ success: true });
});
