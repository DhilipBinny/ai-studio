export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronScheduler, recoverStaleWorkflowRuns } = await import("@ais-app/agent-runtime");
    startCronScheduler();

    recoverStaleWorkflowRuns().catch(() => {});
    setInterval(() => { recoverStaleWorkflowRuns().catch(() => {}); }, 300_000);
  }
}
