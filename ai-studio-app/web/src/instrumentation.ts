export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronScheduler, recoverStaleWorkflowRuns, startProgressWriter } = await import("@ais-app/agent-runtime");
    startCronScheduler();
    startProgressWriter();

    recoverStaleWorkflowRuns().catch(() => {});
    setInterval(() => { recoverStaleWorkflowRuns().catch(() => {}); }, 300_000);
  }
}
