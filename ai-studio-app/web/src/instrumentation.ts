export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronScheduler, recoverStaleWorkflowRuns, startProgressWriter } = await import("@ais-app/agent-runtime");
    startCronScheduler();
    startProgressWriter();

    recoverStaleWorkflowRuns().catch(() => {});
    setInterval(() => { recoverStaleWorkflowRuns().catch(() => {}); }, 300_000);

    async function cleanupExpiredRevocations() {
      try {
        const { getDb } = await import("@ais-app/database");
        const { revokedTokens } = await import("@ais-app/database");
        const { lt } = await import("drizzle-orm");
        const db = getDb();
        await db.delete(revokedTokens).where(lt(revokedTokens.expiresAt, new Date()));
      } catch { /* cleanup failure is non-fatal */ }
    }
    setInterval(() => { cleanupExpiredRevocations().catch(() => {}); }, 3600_000);
  }
}
