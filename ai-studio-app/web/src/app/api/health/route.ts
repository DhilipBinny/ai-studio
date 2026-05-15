import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { sql } from "drizzle-orm";
import { getAuthContext } from "@/lib/api-utils";
import { progressBus } from "@ais-app/agent-runtime/src/progress-bus";
import { getQdrantClient } from "@ais-app/agent-runtime/src/stores/qdrant-client";

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

  // Qdrant health check — only when VECTOR_DB=qdrant
  if (process.env.VECTOR_DB === "qdrant") {
    const qdrantStart = performance.now();
    try {
      const qdrant = getQdrantClient();
      await qdrant.versionInfo();
      checks.qdrant = { status: "healthy", latencyMs: Math.round(performance.now() - qdrantStart) };
    } catch (e) {
      checks.qdrant = { status: "unhealthy", latencyMs: Math.round(performance.now() - qdrantStart), detail: (e as Error).message };
      overall = "unhealthy";
    }
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
  if (auth.role !== "super_admin" && auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required for detail mode" }, { status: 403 });
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

  const busStats = progressBus.getStats();

  return NextResponse.json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || "dev",
    node: process.version,
    checks,
    progressBus: busStats,
  }, { status: overall === "healthy" ? 200 : 503 });
}
