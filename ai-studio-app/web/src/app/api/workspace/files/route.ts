import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withRBAC, errorResponse } from "@/lib/api-utils";

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
    case "run":
      return path.resolve(tenantBase, "runs", id);
    case "shared":
      return path.resolve(tenantBase, "shared");
    default:
      throw new Error("Invalid scope");
  }
}

export const GET = withRBAC("WORKSPACE", 10, async (request, auth) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const id = url.searchParams.get("id") || "";
  const subpath = url.searchParams.get("path") || "";

  if (!scope || !["agent", "run", "shared"].includes(scope)) {
    return errorResponse("scope must be agent, run, or shared", "VALIDATION_ERROR", 400);
  }
  if (scope !== "shared" && !id) {
    return errorResponse("id is required for agent and run scopes", "VALIDATION_ERROR", 400);
  }

  const basePath = getBasePath(scope, id, auth.tenantId);

  let dirPath = basePath;
  if (subpath) {
    if (subpath.includes("\0") || /[\x00-\x1f\x7f]/.test(subpath) || path.isAbsolute(subpath)) {
      return errorResponse("Invalid path", "VALIDATION_ERROR", 400);
    }
    dirPath = path.resolve(basePath, subpath);
    if (dirPath !== basePath && !dirPath.startsWith(basePath + path.sep)) {
      return errorResponse("Path traversal denied", "FORBIDDEN", 403);
    }
  }

  if (!fs.existsSync(dirPath)) {
    return NextResponse.json({ path: subpath || ".", files: [] });
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return errorResponse("Path is not a directory", "VALIDATION_ERROR", 400);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => !e.name.startsWith("."))
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const s = fs.statSync(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? "directory" as const : "file" as const,
          size: entry.isDirectory() ? 0 : s.size,
          modifiedAt: s.mtime.toISOString(),
        };
      } catch {
        return { name: entry.name, type: "file" as const, size: 0, modifiedAt: new Date().toISOString() };
      }
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return NextResponse.json({ path: subpath || ".", files });
});
