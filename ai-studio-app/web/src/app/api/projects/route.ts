import { NextResponse } from "next/server";
import { getDb, projects } from "@ais-app/database";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { paginationSchema } from "@ais-app/validation";
import fs from "node:fs";
import path from "node:path";

export const GET = withRBAC("SETTINGS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const where = eq(projects.tenantId, auth.tenantId);
  const [data, [{ total }]] = await Promise.all([
    db.select().from(projects).where(where)
      .orderBy(desc(projects.createdAt))
      .limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(projects).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize });
});

export const POST = withRBAC("SETTINGS", 20, async (request, auth) => {
  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON", "INVALID_JSON", 400);

  const { name, description, sourceUrl } = body as { name?: string; description?: string; sourceUrl?: string };
  if (!name || name.length < 1 || name.length > 255) {
    return errorResponse("Name required (1-255 chars)", "VALIDATION_ERROR", 400);
  }

  const db = getDb();

  const existing = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.tenantId, auth.tenantId), eq(projects.name, name))).limit(1);
  if (existing.length > 0) return errorResponse("Project name already exists", "NAME_EXISTS", 409);

  const [project] = await db.insert(projects).values({
    tenantId: auth.tenantId,
    name,
    description: description || "",
    sourceUrl: sourceUrl || null,
    createdBy: auth.userId,
  }).returning();

  const dataRoot = process.env.DATA_ROOT || ".data";
  const projectDir = path.resolve(dataRoot, "tenants", auth.tenantId, "projects", project.id);
  fs.mkdirSync(projectDir, { recursive: true });

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "project.create", resourceType: "project", resourceId: project.id,
    details: { name },
  });

  return NextResponse.json(project, { status: 201 });
});
