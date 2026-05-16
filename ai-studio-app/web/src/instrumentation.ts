const globalForInstrumentation = globalThis as unknown as {
  __recoverySweepInterval?: ReturnType<typeof setInterval>;
  __revocationCleanupInterval?: ReturnType<typeof setInterval>;
};

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronScheduler, recoverStaleWorkflowRuns, startProgressWriter } = await import("@ais-app/agent-runtime");
    startCronScheduler();
    startProgressWriter();

    recoverStaleWorkflowRuns().catch((err: unknown) => console.warn("Recovery sweep failed:", err));

    if (process.env.VECTOR_DB === "qdrant") {
      const { ensureQdrantCollections } = await import("@ais-app/agent-runtime");
      ensureQdrantCollections().catch((err: unknown) => console.warn("Qdrant collection init failed:", err));
    }
    if (!globalForInstrumentation.__recoverySweepInterval) {
      globalForInstrumentation.__recoverySweepInterval = setInterval(() => { recoverStaleWorkflowRuns().catch((err: unknown) => console.warn("Recovery sweep failed:", err)); }, 120_000);
    }

    async function cleanupExpiredRevocations() {
      try {
        const { getDb } = await import("@ais-app/database");
        const { revokedTokens } = await import("@ais-app/database");
        const { lt } = await import("drizzle-orm");
        const db = getDb();
        await db.delete(revokedTokens).where(lt(revokedTokens.expiresAt, new Date()));
      } catch (err: unknown) { console.warn("Revocation cleanup failed:", err); }
    }
    if (!globalForInstrumentation.__revocationCleanupInterval) {
      globalForInstrumentation.__revocationCleanupInterval = setInterval(() => { cleanupExpiredRevocations().catch((err: unknown) => console.warn("Revocation cleanup failed:", err)); }, 3600_000);
    }
  }
}
