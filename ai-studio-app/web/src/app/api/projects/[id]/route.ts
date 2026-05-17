import { NextResponse } from "next/server";
import { getDb, projects } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const GET = withRBAC("SETTINGS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Project ID required", "MISSING_ID", 400);

  const db = getDb();
  const [project] = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, auth.tenantId))).limit(1);

  if (!project) return errorResponse("Not found", "NOT_FOUND", 404);

  const dataRoot = process.env.DATA_ROOT || ".data";
  const projectDir = path.resolve(dataRoot, "tenants", auth.tenantId, "projects", project.id);
  const hasFiles = fs.existsSync(projectDir);

  return NextResponse.json({ ...project, hasFiles, path: projectDir });
});

export const PATCH = withRBAC("SETTINGS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Project ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON", "INVALID_JSON", 400);

  const db = getDb();
  const [existing] = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, auth.tenantId))).limit(1);
  if (!existing) return errorResponse("Not found", "NOT_FOUND", 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.status) updates.status = body.status;

  const [updated] = await db.update(projects).set(updates)
    .where(eq(projects.id, id)).returning();

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "project.update", resourceType: "project", resourceId: id,
    details: { fields: Object.keys(updates) },
  });

  return NextResponse.json(updated);
});

export const POST = withRBAC("SETTINGS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Project ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON", "INVALID_JSON", 400);

  const db = getDb();
  const [project] = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, auth.tenantId))).limit(1);
  if (!project) return errorResponse("Not found", "NOT_FOUND", 404);

  const { action, sourcePath, gitUrl } = body as { action?: string; sourcePath?: string; gitUrl?: string };
  const dataRoot = process.env.DATA_ROOT || ".data";
  const projectDir = path.resolve(dataRoot, "tenants", auth.tenantId, "projects", project.id);
  fs.mkdirSync(projectDir, { recursive: true });

  if (action === "clone" && gitUrl) {
    try {
      execFileSync("git", ["clone", gitUrl, "."], { cwd: projectDir, timeout: 120000 });
      return NextResponse.json({ success: true, action: "cloned", path: projectDir });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Clone failed";
      return errorResponse(msg, "CLONE_FAILED", 500);
    }
  }

  if (action === "copy" && sourcePath) {
    const resolvedSource = path.resolve(sourcePath);
    const blockedPrefixes = ["/etc", "/var", "/usr", "/bin", "/sbin", "/proc", "/sys", "/dev", "/root"];
    if (blockedPrefixes.some(p => resolvedSource.startsWith(p))) {
      return errorResponse("Source path not allowed", "SOURCE_BLOCKED", 403);
    }
    if (!fs.existsSync(resolvedSource)) {
      return errorResponse("Source path does not exist", "SOURCE_NOT_FOUND", 400);
    }
    try {
      execFileSync("cp", ["-r", `${resolvedSource}/.`, `${projectDir}/`], { timeout: 60000 });
      return NextResponse.json({ success: true, action: "copied", path: projectDir });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Copy failed";
      return errorResponse(msg, "COPY_FAILED", 500);
    }
  }

  if (action === "init_git") {
    try {
      execFileSync("git", ["init"], { cwd: projectDir, timeout: 10000 });
      return NextResponse.json({ success: true, action: "git_initialized", path: projectDir });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Git init failed";
      return errorResponse(msg, "GIT_INIT_FAILED", 500);
    }
  }

  return errorResponse("Invalid action. Use: clone, copy, or init_git", "INVALID_ACTION", 400);
});

export const DELETE = withRBAC("SETTINGS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Project ID required", "MISSING_ID", 400);

  const db = getDb();
  const [project] = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, auth.tenantId))).limit(1);
  if (!project) return errorResponse("Not found", "NOT_FOUND", 404);

  await db.update(projects).set({ status: "archived", updatedAt: new Date() })
    .where(eq(projects.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "project.archive", resourceType: "project", resourceId: id,
  });

  return NextResponse.json({ success: true });
});
