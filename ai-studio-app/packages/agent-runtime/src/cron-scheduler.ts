import { getDb } from "@ais-app/database";
import { cronJobs, cronJobRuns } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { runSession } from "./session-runner";
import { triggerWorkflow } from "./workflow-engine";

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  if (field === "*") return null;
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range: string;
    let step = 1;
    if (stepMatch) {
      range = stepMatch[1];
      step = parseInt(stepMatch[2]);
    } else {
      range = part;
    }
    if (range === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      for (let i = a; i <= b; i += step) values.add(i);
    } else {
      values.add(parseInt(range));
    }
  }
  return values;
}

function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minF, hourF, domF, monF, dowF] = parts;
  const minute = parseCronField(minF, 0, 59);
  const hour = parseCronField(hourF, 0, 23);
  const dom = parseCronField(domF, 1, 31);
  const month = parseCronField(monF, 1, 12);
  const dow = parseCronField(dowF, 0, 6);

  if (minute && !minute.has(date.getMinutes())) return false;
  if (hour && !hour.has(date.getHours())) return false;
  if (dom && !dom.has(date.getDate())) return false;
  if (month && !month.has(date.getMonth() + 1)) return false;
  if (dow && !dow.has(date.getDay())) return false;
  return true;
}

function getTimeInZone(tz: string): Date {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0");
    return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  } catch {
    return new Date();
  }
}

// ---------------------------------------------------------------------------
// Job execution with run history recording
// ---------------------------------------------------------------------------

interface JobPayload {
  id: string;
  tenantId: string;
  userId: string | null;
  agentId: string | null;
  workflowId: string | null;
  triggerType: string;
  prompt: string;
  name: string;
  runCount: number;
  scheduleType: string;
  workflowInput: Record<string, unknown>;
  trigger: "scheduled" | "manual";
}

const runningJobs = new Set<string>();

async function executeJob(job: JobPayload): Promise<void> {
  if (runningJobs.has(job.id)) return;
  runningJobs.add(job.id);

  const db = getDb();
  const startTime = Date.now();

  const [run] = await db.insert(cronJobRuns).values({
    tenantId: job.tenantId,
    cronJobId: job.id,
    status: "running",
    trigger: job.trigger,
    startedAt: new Date(),
  }).returning({ id: cronJobRuns.id });

  try {
    let resultText = "";

    if (job.triggerType === "agent" && job.agentId) {
      const result = await runSession({
        agentId: job.agentId,
        tenantId: job.tenantId,
        userId: job.userId || "",
        message: job.prompt,
        channel: "cron",
        metadata: { cronJobId: job.id, cronJobName: job.name },
      });
      resultText = result.response?.slice(0, 500) || "";
      if (result.error) throw new Error(result.error);
    } else if (job.triggerType === "workflow" && job.workflowId) {
      const input = Object.keys(job.workflowInput || {}).length > 0
        ? job.workflowInput
        : { prompt: job.prompt };
      const result = await triggerWorkflow(job.workflowId, job.tenantId, job.userId, input);
      resultText = result.status === "completed" ? "Workflow completed" : `Workflow ${result.status}`;
      if (result.error) throw new Error(result.error);
    } else {
      throw new Error(`Invalid trigger: type=${job.triggerType}, agentId=${job.agentId}, workflowId=${job.workflowId}`);
    }

    const durationMs = Date.now() - startTime;

    await db.update(cronJobRuns).set({
      status: "completed",
      resultText,
      durationMs,
      completedAt: new Date(),
    }).where(eq(cronJobRuns.id, run.id));

    await db.update(cronJobs).set({
      lastRun: new Date(),
      lastResult: resultText,
      lastError: null,
      runCount: job.runCount + 1,
      updatedAt: new Date(),
    }).where(eq(cronJobs.id, job.id));

    // Auto-disable "at" (one-time) jobs after execution
    if (job.scheduleType === "at") {
      await db.update(cronJobs).set({ enabled: false, updatedAt: new Date() }).where(eq(cronJobs.id, job.id));
    }
  } catch (e) {
    const durationMs = Date.now() - startTime;
    const errorMsg = (e as Error).message;

    await db.update(cronJobRuns).set({
      status: "failed",
      errorMessage: errorMsg,
      durationMs,
      completedAt: new Date(),
    }).where(eq(cronJobRuns.id, run.id));

    await db.update(cronJobs).set({
      lastRun: new Date(),
      lastError: errorMsg,
      runCount: job.runCount + 1,
      updatedAt: new Date(),
    }).where(eq(cronJobs.id, job.id));
  } finally {
    runningJobs.delete(job.id);
  }
}

// ---------------------------------------------------------------------------
// Tick — check all enabled jobs against their schedule
// ---------------------------------------------------------------------------

let tickInterval: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const db = getDb();

  const jobs = await db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.enabled, true));

  for (const job of jobs) {
    let shouldRun = false;

    if (job.scheduleType === "cron") {
      const tz = job.timezone || "UTC";
      const now = getTimeInZone(tz);
      shouldRun = cronMatches(job.scheduleValue, now);
    } else if (job.scheduleType === "every") {
      const intervalMs = parseInt(job.scheduleValue, 10);
      if (!isNaN(intervalMs) && intervalMs > 0) {
        const lastRunTime = job.lastRun ? new Date(job.lastRun).getTime() : 0;
        shouldRun = Date.now() >= lastRunTime + intervalMs;
      }
    } else if (job.scheduleType === "at") {
      const scheduledTime = new Date(job.scheduleValue).getTime();
      if (!isNaN(scheduledTime) && Date.now() >= scheduledTime && job.runCount === 0) {
        shouldRun = true;
      }
    }

    if (shouldRun) {
      executeJob({
        id: job.id, tenantId: job.tenantId, userId: job.userId,
        agentId: job.agentId, workflowId: job.workflowId,
        triggerType: job.triggerType, prompt: job.prompt,
        name: job.name, runCount: job.runCount,
        scheduleType: job.scheduleType,
        workflowInput: (job.workflowInput || {}) as Record<string, unknown>,
        trigger: "scheduled",
      }).catch(() => {});
    }
  }
}

export function startCronScheduler(): void {
  if (tickInterval) return;
  tickInterval = setInterval(() => { tick().catch(() => {}); }, 60_000);
  tick().catch(() => {});
}

export function stopCronScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export async function runJobNow(jobId: string, tenantId: string): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const [job] = await db.select().from(cronJobs).where(and(eq(cronJobs.id, jobId), eq(cronJobs.tenantId, tenantId))).limit(1);
  if (!job) return { success: false, error: "Job not found" };

  try {
    await executeJob({
      id: job.id, tenantId: job.tenantId, userId: job.userId,
      agentId: job.agentId, workflowId: job.workflowId,
      triggerType: job.triggerType, prompt: job.prompt,
      name: job.name, runCount: job.runCount,
      scheduleType: job.scheduleType,
      workflowInput: (job.workflowInput || {}) as Record<string, unknown>,
      trigger: "manual",
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
