import { NextRequest, NextResponse } from "next/server";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import fs from "fs";
import path from "path";

const DOCS_ROOT = path.resolve(process.cwd(), "../../docs/feature");

function safePath(requestedPath: string): string | null {
  const cleaned = requestedPath.replace(/\.\./g, "").replace(/^\/+/, "");
  const resolved = path.resolve(DOCS_ROOT, cleaned);
  if (!resolved.startsWith(DOCS_ROOT)) return null;
  return resolved;
}

export const GET = withRBAC("DOCS", 10, async (request: NextRequest) => {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");

  if (!filePath) {
    // Return file tree
    try {
      const files = fs.readdirSync(DOCS_ROOT)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => {
          const stat = fs.statSync(path.join(DOCS_ROOT, f));
          const title = f.replace(/^\d+_/, "").replace(/\.md$/, "").replace(/_/g, " ");
          return { filename: f, title, sizeKb: Math.round(stat.size / 1024) };
        });
      return NextResponse.json({ files });
    } catch {
      return NextResponse.json({ files: [] });
    }
  }

  // Return single file content
  const resolved = safePath(filePath);
  if (!resolved) return errorResponse("Invalid path", "INVALID_PATH", 400);

  try {
    const content = fs.readFileSync(resolved, "utf-8");
    return NextResponse.json({ filename: path.basename(resolved), content });
  } catch {
    return errorResponse("File not found", "NOT_FOUND", 404);
  }
});
