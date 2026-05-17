import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { knowledgeBases, documents } from "@ais-app/database";
import { eq, and, desc, count } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const UPLOAD_BASE = join(process.cwd(), "..", ".data", "uploads");
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_TYPES = new Set(["text/plain", "text/markdown", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".csv", ".docx"]);

export const GET = withRBAC("KNOWLEDGE", 10, async (request, auth, params) => {
  const kbId = params?.id;
  if (!kbId) return errorResponse("KB ID required", "MISSING_ID", 400);

  const db = getDb();
  const [kb] = await db
    .select({ id: knowledgeBases.id })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, auth.tenantId)))
    .limit(1);

  if (!kb) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "15")));

  const where = and(eq(documents.knowledgeBaseId, kbId), eq(documents.tenantId, auth.tenantId));

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: documents.id,
      fileName: documents.fileName,
      fileType: documents.fileType,
      fileSizeBytes: documents.fileSizeBytes,
      status: documents.status,
      chunkCount: documents.chunkCount,
      errorMessage: documents.errorMessage,
      processedAt: documents.processedAt,
      createdAt: documents.createdAt,
    })
      .from(documents)
      .where(where)
      .orderBy(desc(documents.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(documents).where(where),
  ]);

  return NextResponse.json({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

export const POST = withRBAC("KNOWLEDGE", 20, async (request, auth, params) => {
  const kbId = params?.id;
  if (!kbId) return errorResponse("KB ID required", "MISSING_ID", 400);

  const db = getDb();
  const [kb] = await db
    .select({ id: knowledgeBases.id, name: knowledgeBases.name })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, auth.tenantId), eq(knowledgeBases.isActive, true)))
    .limit(1);

  if (!kb) return errorResponse("Knowledge base not found", "NOT_FOUND", 404);

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return errorResponse("File is required", "MISSING_FILE", 400);

  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return errorResponse(`Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`, "INVALID_FILE_TYPE", 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return errorResponse(`File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`, "FILE_TOO_LARGE", 400);
  }

  const fileId = randomUUID();
  const storagePath = join(auth.tenantId, kbId, `${fileId}${ext}`);
  const fullPath = join(UPLOAD_BASE, storagePath);

  await mkdir(join(UPLOAD_BASE, auth.tenantId, kbId), { recursive: true });

  const bytes = await file.arrayBuffer();
  await writeFile(fullPath, Buffer.from(bytes));

  const [doc] = await db.insert(documents).values({
    tenantId: auth.tenantId,
    knowledgeBaseId: kbId,
    fileName: file.name,
    fileType: ext.slice(1),
    fileSizeBytes: file.size,
    storagePath,
    status: "uploaded",
    uploadedBy: auth.userId,
  }).returning();

  await db
    .update(knowledgeBases)
    .set({ documentCount: (await db.select({ c: count() }).from(documents).where(eq(documents.knowledgeBaseId, kbId)))[0].c, updatedAt: new Date() })
    .where(eq(knowledgeBases.id, kbId));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "document.upload",
    resourceType: "document",
    resourceId: doc.id,
    details: { fileName: file.name, knowledgeBaseId: kbId, knowledgeBaseName: kb.name },
  });

  return NextResponse.json(doc, { status: 201 });
});
