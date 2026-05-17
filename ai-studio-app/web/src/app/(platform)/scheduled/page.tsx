"use client";
import { RequirePermission } from "@/components/require-permission";
import { formatRelativeTime } from "@/lib/utils";
import { FormError } from "@/components/form-error";

import { useState, useEffect, useCallback } from "react";
import { Plus, Play, Trash2, Loader2, Clock, Pause, Pencil, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableSkeleton } from "@/components/table-skeleton";
import { Pagination } from "@/components/pagination";

interface CronJob {
  id: string; name: string; triggerType: string; scheduleType: string; scheduleValue: string;
  timezone: string | null; prompt: string; enabled: boolean; agentId: string | null; workflowId: string | null;
  workflowInput: Record<string, unknown>;
  lastRun: string | null; lastResult: string | null; lastError: string | null; runCount: number; createdAt: string;
}

interface CronJobRun {
  id: string; status: string; trigger: string; resultText: string | null;
  errorMessage: string | null; durationMs: number | null; startedAt: string; completedAt: string | null;
}

const SCHEDULE_LABELS: Record<string, string> = { cron: "Cron", every: "Interval", at: "One-Time" };

export default function ScheduledJobsPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<CronJob | null>(null);
  const [historyTarget, setHistoryTarget] = useState<CronJob | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [wfs, setWfs] = useState<Array<{ id: string; name: string }>>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/cron-jobs?pageSize=50");
    if (res.ok) { const d = await res.json(); setJobs(d.data || []); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchJobs();
    fetch("/api/agents?pageSize=100").then((r) => r.ok ? r.json() : { data: [] }).then((d) => setAgents(d.data.map((a: Record<string, string>) => ({ id: a.id, name: a.name }))));
    fetch("/api/workflows?pageSize=100").then((r) => r.ok ? r.json() : { data: [] }).then((d) => setWfs(d.data.map((w: Record<string, string>) => ({ id: w.id, name: w.name }))));
  }, [fetchJobs]);

  async function handleToggle(id: string, enabled: boolean) {
    await fetch(`/api/cron-jobs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
    await fetchJobs();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    await fetch(`/api/cron-jobs/${deleteTarget.id}`, { method: "DELETE" });
    await fetchJobs();
    setDeleting(false);
    setDeleteTarget(null);
  }

  async function handleRunNow(id: string) {
    setRunning(id);
    await fetch(`/api/cron-jobs/${id}`, { method: "POST" });
    await fetchJobs();
    setRunning(null);
  }

  function formatSchedule(job: CronJob): string {
    if (job.scheduleType === "every") {
      const ms = parseInt(job.scheduleValue, 10);
      if (ms >= 3600000) return `Every ${Math.round(ms / 3600000)}h`;
      return `Every ${Math.round(ms / 60000)}m`;
    }
    if (job.scheduleType === "at") {
      try { return new Date(job.scheduleValue).toLocaleString(); } catch { return job.scheduleValue; }
    }
    return job.scheduleValue;
  }

  return (
    <RequirePermission module="SCHEDULED"><>
      <PageHeader title="Scheduled Jobs" description="Schedule agents or workflows to run automatically on a cron schedule.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New Job</Button>
      </PageHeader>

      {loading ? (
        <Card><div className="p-6"><TableSkeleton columns={6} /></div></Card>
      ) : jobs.length === 0 ? (
        <EmptyState icon={Clock} title="No scheduled jobs" description="Create a job to trigger agents or workflows on a timer." actionLabel="New Job" onAction={() => setShowCreate(true)} />
      ) : (
        <Card><Table>
          <TableHeader><TableRow>
            <TableHead>Job</TableHead><TableHead>Schedule</TableHead><TableHead>Trigger</TableHead>
            <TableHead>Last Run</TableHead><TableHead>Runs</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {jobs.map((j) => (
              <TableRow key={j.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${j.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                    <span className="sr-only">{j.enabled ? "Enabled" : "Disabled"}</span>
                    <div>
                      <div className="font-medium text-sm">{j.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate max-w-48">{j.prompt.slice(0, 60)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{SCHEDULE_LABELS[j.scheduleType] || j.scheduleType}</Badge>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{formatSchedule(j)}</code>
                  </div>
                  {j.timezone && <div className="text-[10px] text-muted-foreground mt-0.5">{j.timezone}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{j.triggerType}</Badge>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {j.triggerType === "agent" ? agents.find((a) => a.id === j.agentId)?.name || "—" : wfs.find((w) => w.id === j.workflowId)?.name || "—"}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {j.lastRun ? (
                    <div>
                      <div className="text-muted-foreground">{formatRelativeTime(j.lastRun)}</div>
                      {j.lastError && <div className="text-destructive truncate max-w-32">{j.lastError}</div>}
                    </div>
                  ) : <span className="text-muted-foreground">Never</span>}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{j.runCount}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRunNow(j.id)} disabled={running === j.id} aria-label="Run now">
                      {running === j.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditTarget(j)} aria-label="Edit job">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setHistoryTarget(j)} aria-label="View run history">
                      <History className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleToggle(j.id, j.enabled)} aria-label={j.enabled ? "Pause" : "Resume"}>
                      {j.enabled ? <Pause className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(j)} aria-label="Delete job">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></Card>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate} size="xl">
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>New Scheduled Job</DialogTitle></DialogHeader>
          <CronJobForm agents={agents} workflows={wfs} onDone={() => { setShowCreate(false); fetchJobs(); }} />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }} size="xl">
        <DialogContent onClose={() => setEditTarget(null)}>
          <DialogHeader><DialogTitle>Edit Scheduled Job</DialogTitle></DialogHeader>
          {editTarget && <CronJobForm agents={agents} workflows={wfs} existing={editTarget} onDone={() => { setEditTarget(null); fetchJobs(); }} />}
        </DialogContent>
      </Dialog>

      {/* Run History Dialog */}
      <Dialog open={!!historyTarget} onOpenChange={(open) => { if (!open) setHistoryTarget(null); }} size="2xl">
        <DialogContent onClose={() => setHistoryTarget(null)}>
          <DialogHeader><DialogTitle>Run History — {historyTarget?.name}</DialogTitle></DialogHeader>
          {historyTarget && <RunHistoryPanel jobId={historyTarget.id} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={handleDelete}
        title="Delete scheduled job"
        description={`Are you sure you want to delete "${deleteTarget?.name || ""}"? The job will stop running immediately.`}
        confirmLabel="Delete"
        loading={deleting}
      />
    </></RequirePermission>
  );
}

// ---------------------------------------------------------------------------
// Unified Create / Edit Form
// ---------------------------------------------------------------------------

function CronJobForm({ agents, workflows, existing, onDone }: {
  agents: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
  existing?: CronJob;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: existing?.name || "",
    triggerType: existing?.triggerType || "agent",
    agentId: existing?.agentId || "",
    workflowId: existing?.workflowId || "",
    scheduleType: existing?.scheduleType || "cron",
    scheduleValue: existing ? (
      existing.scheduleType === "every" ? String(Math.round(parseInt(existing.scheduleValue, 10) / 60000)) : existing.scheduleValue
    ) : "0 9 * * *",
    timezone: existing?.timezone || "UTC",
    prompt: existing?.prompt || "",
    workflowInput: JSON.stringify(existing?.workflowInput || {}, null, 2),
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resolveScheduleValue(): string {
    if (form.scheduleType === "every") return String(parseInt(form.scheduleValue, 10) * 60000);
    return form.scheduleValue;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSubmitting(true);

    let workflowInput: Record<string, unknown> = {};
    if (form.triggerType === "workflow" && form.workflowInput.trim()) {
      try { workflowInput = JSON.parse(form.workflowInput); } catch { setError("Invalid workflow input JSON"); setSubmitting(false); return; }
    }

    const payload = {
      name: form.name,
      triggerType: form.triggerType,
      agentId: form.triggerType === "agent" ? form.agentId : null,
      workflowId: form.triggerType === "workflow" ? form.workflowId : null,
      scheduleType: form.scheduleType,
      scheduleValue: resolveScheduleValue(),
      timezone: form.timezone || "UTC",
      prompt: form.prompt,
      workflowInput,
    };

    const url = existing ? `/api/cron-jobs/${existing.id}` : "/api/cron-jobs";
    const method = existing ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) onDone(); else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <FormError message={error} />
      <div className="space-y-2">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Daily Summary" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Trigger Type</Label>
          <Select value={form.triggerType} onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value }))}>
            <option value="agent">Agent Session</option>
            <option value="workflow">Workflow Run</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{form.triggerType === "agent" ? "Agent" : "Workflow"} <span className="text-destructive">*</span></Label>
          {form.triggerType === "agent" ? (
            <Select value={form.agentId} onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))} required>
              <option value="">Select agent...</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          ) : (
            <Select value={form.workflowId} onChange={(e) => setForm((f) => ({ ...f, workflowId: e.target.value }))} required>
              <option value="">Select workflow...</option>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>Schedule Type</Label>
          <Select value={form.scheduleType} onChange={(e) => setForm((f) => ({ ...f, scheduleType: e.target.value, scheduleValue: e.target.value === "cron" ? "0 9 * * *" : e.target.value === "every" ? "30" : "" }))}>
            <option value="cron">Cron Expression</option>
            <option value="every">Interval</option>
            <option value="at">One-Time</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>
            {form.scheduleType === "cron" ? "Expression" : form.scheduleType === "every" ? "Every (minutes)" : "Run At"}
            <span className="text-destructive"> *</span>
          </Label>
          {form.scheduleType === "cron" && (
            <Input value={form.scheduleValue} onChange={(e) => setForm((f) => ({ ...f, scheduleValue: e.target.value }))} required placeholder="0 9 * * *" className="font-mono" />
          )}
          {form.scheduleType === "every" && (
            <Input type="number" min="1" value={form.scheduleValue} onChange={(e) => setForm((f) => ({ ...f, scheduleValue: e.target.value }))} required placeholder="30" />
          )}
          {form.scheduleType === "at" && (
            <Input type="datetime-local" value={form.scheduleValue} onChange={(e) => setForm((f) => ({ ...f, scheduleValue: e.target.value }))} required />
          )}
        </div>
        <div className="space-y-2">
          <Label>Timezone</Label>
          <Input value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} placeholder="Asia/Singapore" />
        </div>
      </div>

      {form.scheduleType === "cron" && (
        <p className="text-[11px] text-muted-foreground -mt-2">5 fields: minute hour day month weekday. Example: <code>0 9 * * 1-5</code> = 9am weekdays</p>
      )}
      {form.scheduleType === "every" && (
        <p className="text-[11px] text-muted-foreground -mt-2">Minimum 1 minute. The job runs on each tick after the interval has elapsed.</p>
      )}

      <div className="space-y-2">
        <Label>Prompt <span className="text-destructive">*</span></Label>
        <Textarea value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} rows={3} required placeholder="Generate a daily status report summarizing..." />
      </div>

      {form.triggerType === "workflow" && (
        <div className="space-y-2">
          <Label>Workflow Input (JSON)</Label>
          <Textarea value={form.workflowInput} onChange={(e) => setForm((f) => ({ ...f, workflowInput: e.target.value }))} rows={3} className="font-mono text-xs" placeholder='{"text": "Document to analyze", "mode": "deep"}' />
          <p className="text-[11px] text-muted-foreground">JSON object passed as workflow input. If empty, the prompt is used as <code>{"{ prompt }"}</code>.</p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Saving..." : existing ? "Save Changes" : "Create Job"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Run History Panel
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, "success" | "error" | "warning" | "info" | "secondary"> = {
  completed: "success", failed: "error", running: "info",
};

function RunHistoryPanel({ jobId }: { jobId: string }) {
  const [runs, setRuns] = useState<CronJobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const pageSize = 15;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cron-jobs/${jobId}/runs?page=${page}&pageSize=${pageSize}`)
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d) => { setRuns(d.data || []); setTotal(d.total || 0); setTotalPages(d.totalPages || 0); setLoading(false); });
  }, [jobId, page]);

  if (loading) return <div className="flex items-center justify-center h-24"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (runs.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No runs yet.</p>;

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Status</TableHead><TableHead>Trigger</TableHead><TableHead>Duration</TableHead>
          <TableHead>Started</TableHead><TableHead>Result / Error</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Badge variant={STATUS_BADGE[r.status] || "secondary"}>{r.status}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.trigger}</TableCell>
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {r.durationMs != null ? (r.durationMs < 1000 ? `${r.durationMs}ms` : `${(r.durationMs / 1000).toFixed(1)}s`) : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatRelativeTime(r.startedAt)}</TableCell>
              <TableCell className="text-xs max-w-48 truncate">
                {r.errorMessage ? <span className="text-destructive">{r.errorMessage}</span> : (r.resultText ? <span className="text-muted-foreground">{r.resultText.slice(0, 80)}</span> : "—")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {totalPages > 1 && <Pagination page={page} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} />}
    </div>
  );
}
