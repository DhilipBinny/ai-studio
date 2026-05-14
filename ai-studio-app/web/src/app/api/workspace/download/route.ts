import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withRBAC, errorResponse } from "@/lib/api-utils";

const MIME_MAP: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".js": "text/plain",
  ".jsx": "text/plain",
  ".py": "text/plain",
  ".sh": "text/plain",
  ".sql": "text/plain",
  ".css": "text/css",
  ".html": "text/html",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function getBasePath(scope: string, id: string, tenantId: string): string {
  const dataRoot = process.env.DATA_ROOT || ".data";
  const tenantBase = path.resolve(dataRoot, "tenants", tenantId, "workspace");
  switch (scope) {
    case "agent": {
      const newPath = path.resolve(tenantBase, "agents", id);
      const legacyPath = path.resolve(tenantBase, id);
      if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) return legacyPath;
      return newPath;
    }
    case "run": return path.resolve(tenantBase, "runs", id);
    case "shared": return path.resolve(tenantBase, "shared");
    default: throw new Error("Invalid scope");
  }
}

export const GET = withRBAC("WORKSPACE", 10, async (request, auth) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const id = url.searchParams.get("id") || "";
  const filePath = url.searchParams.get("path") || "";

  if (!scope || !["agent", "run", "shared"].includes(scope)) {
    return errorResponse("scope must be agent, run, or shared", "VALIDATION_ERROR", 400);
  }
  if (!filePath) {
    return errorResponse("path is required", "VALIDATION_ERROR", 400);
  }
  if (filePath.includes("\0") || /[\x00-\x1f\x7f]/.test(filePath) || path.isAbsolute(filePath)) {
    return errorResponse("Invalid path", "VALIDATION_ERROR", 400);
  }

  const basePath = getBasePath(scope, id, auth.tenantId);
  const resolved = path.resolve(basePath, filePath);

  if (resolved !== basePath && !resolved.startsWith(basePath + path.sep)) {
    return errorResponse("Path traversal denied", "FORBIDDEN", 403);
  }

  if (!fs.existsSync(resolved)) {
    return errorResponse("File not found", "NOT_FOUND", 404);
  }

  const buffer = fs.readFileSync(resolved);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const fileName = path.basename(filePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
    },
  });
});
