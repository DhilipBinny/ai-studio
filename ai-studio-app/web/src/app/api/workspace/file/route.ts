import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withRBAC, errorResponse } from "@/lib/api-utils";

const MAX_PREVIEW_BYTES = 102400;

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

function isBinary(buffer: Buffer): boolean {
  const check = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
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

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return errorResponse("Path is a directory", "VALIDATION_ERROR", 400);
  }

  const buffer = fs.readFileSync(resolved);
  const binary = isBinary(buffer);
  const truncated = !binary && buffer.length > MAX_PREVIEW_BYTES;
  const content = binary ? null : buffer.subarray(0, MAX_PREVIEW_BYTES).toString("utf-8");

  return NextResponse.json({
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    content,
    truncated,
    binary,
  });
});
