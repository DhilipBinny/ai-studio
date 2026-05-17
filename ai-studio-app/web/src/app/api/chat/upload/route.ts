import { NextResponse } from "next/server";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { createAuditEntry } from "@/lib/services/audit";

const UPLOAD_BASE = join(process.cwd(), "..", ".data", "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log", ".py", ".js", ".ts", ".sql", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log", ".py", ".js", ".ts", ".sql"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export const POST = withRBAC("AGENTS", 10, async (request, auth) => {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return errorResponse("File is required", "MISSING_FILE", 400);

  const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return errorResponse(
      `Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      "INVALID_FILE_TYPE",
      400,
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return errorResponse(`File too large. Maximum: ${MAX_FILE_SIZE / 1024 / 1024}MB`, "FILE_TOO_LARGE", 400);
  }

  const fileId = randomUUID();
  const dir = join(UPLOAD_BASE, auth.tenantId, "chat");
  const storagePath = join(auth.tenantId, "chat", `${fileId}${ext}`);
  const fullPath = join(UPLOAD_BASE, storagePath);

  await mkdir(dir, { recursive: true });
  const bytes = await file.arrayBuffer();
  await writeFile(fullPath, Buffer.from(bytes));

  let textContent: string | null = null;
  if (TEXT_EXTENSIONS.has(ext) && file.size <= 500_000) {
    textContent = Buffer.from(bytes).toString("utf-8");
  }

  const category = IMAGE_EXTENSIONS.has(ext) ? "image" : ext === ".pdf" ? "pdf" : "text";

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "chat.file_upload",
    resourceType: "chat_attachment",
    resourceId: fileId,
    details: { fileName: file.name, fileType: ext.slice(1), fileSizeBytes: file.size, category },
  });

  return NextResponse.json({
    id: fileId,
    fileName: file.name,
    fileType: ext.slice(1),
    fileSizeBytes: file.size,
    storagePath,
    category,
    textContent,
  }, { status: 201 });
});
