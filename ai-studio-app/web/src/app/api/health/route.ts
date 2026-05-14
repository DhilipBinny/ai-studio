import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { sql } from "drizzle-orm";
import { getAuthContext } from "@/lib/api-utils";

const startTime = Date.now();

export async function GET(request: NextRequest) {
  const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};
  let overall: "healthy" | "degraded" | "unhealthy" = "healthy";

  const dbStart = performance.now();
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "healthy", latencyMs: Math.round(performance.now() - dbStart) };
  } catch (e) {
    checks.database = { status: "unhealthy", latencyMs: Math.round(performance.now() - dbStart), detail: (e as Error).message };
    overall = "unhealthy";
  }

  const publicResponse = {
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };

  const wantsDetail = request.nextUrl.searchParams.get("detail") === "true";
  if (!wantsDetail) {
    return NextResponse.json(publicResponse, { status: overall === "healthy" ? 200 : 503 });
  }

  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required for detail mode" }, { status: 401 });
  }

  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const maxRssMB = Number(process.env.HEALTH_MAX_RSS_MB) || 8192;
  const memoryDegraded = rssMB > maxRssMB;

  if (memoryDegraded) {
    overall = overall === "unhealthy" ? "unhealthy" : "degraded";
  }

  checks.memory = {
    status: memoryDegraded ? "degraded" : "healthy",
    detail: `RSS ${rssMB}MB (threshold ${maxRssMB}MB), Heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
  };

  return NextResponse.json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || "dev",
    node: process.version,
    checks,
  }, { status: overall === "healthy" ? 200 : 503 });
}
