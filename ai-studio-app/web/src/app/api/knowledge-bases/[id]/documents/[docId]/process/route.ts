import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { documents } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { processDocument } from "@/lib/rag/processor";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("KNOWLEDGE", 20, async (_request, auth, params) => {
  const { id: kbId, docId } = params || {};
  if (!kbId || !docId) return errorResponse("KB ID and Document ID required", "MISSING_ID", 400);

  const db = getDb();
  const [doc] = await db
    .select({ id: documents.id, fileName: documents.fileName, status: documents.status })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.knowledgeBaseId, kbId), eq(documents.tenantId, auth.tenantId)))
    .limit(1);

  if (!doc) return errorResponse("Document not found", "NOT_FOUND", 404);
  if (doc.status === "processing") return errorResponse("Document is already being processed", "ALREADY_PROCESSING", 409);

  processDocument(docId, auth.tenantId).catch((e) => {
    console.error(`Document processing failed for ${docId}:`, (e as Error).message);
  });

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "document.process",
    resourceType: "document",
    resourceId: docId,
    details: { fileName: doc.fileName, knowledgeBaseId: kbId },
  });

  return NextResponse.json({ status: "processing", message: "Document processing started" });
});
