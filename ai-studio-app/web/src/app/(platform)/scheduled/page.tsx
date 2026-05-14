"use client";
import { RequirePermission } from "@/components/require-permission";
import { formatRelativeTime } from "@/lib/utils";

import { useState, useEffect, useCallback } from "react";
import { Plus, Play, Trash2, Loader2, Clock, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface CronJob {
  id: string; name: string; triggerType: string; scheduleType: string; scheduleValue: string;
  timezone: string | null; prompt: string; enabled: boolean; agentId: string | null; workflowId: string | null;
  lastRun: string | null; lastResult: string | null; lastError: string | null; runCount: number; createdAt: string;
}

export default function ScheduledJobsPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [wfs, setWfs] = useState<Array<{ id: string; name: string }>>([]);
  const [running, setRunning] = useState<string | null>(null);

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

  async function handleDelete(id: string) {
    await fetch(`/api/cron-jobs/${id}`, { method: "DELETE" });
    await fetchJobs();
  }

  async function handleRunNow(id: string) {
    setRunning(id);
    await fetch(`/api/cron-jobs/${id}`, { method: "POST" });
    await fetchJobs();
    setRunning(null);
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
                    <div>
                      <div className="font-medium text-sm">{j.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate max-w-48">{j.prompt.slice(0, 60)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{j.scheduleValue}</code>
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
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleToggle(j.id, j.enabled)} aria-label={j.enabled ? "Pause" : "Resume"}>
                      {j.enabled ? <Pause className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(j.id)} aria-label="Delete job">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></Card>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate} size="xl">
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>New Scheduled Job</DialogTitle></DialogHeader>
          <CreateCronJobForm agents={agents} workflows={wfs} onCreated={() => { setShowCreate(false); fetchJobs(); }} />
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function CreateCronJobForm({ agents, workflows, onCreated }: { agents: Array<{ id: string; name: string }>; workflows: Array<{ id: string; name: string }>; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", triggerType: "agent", agentId: "", workflowId: "", scheduleValue: "0 9 * * *", timezone: "UTC", prompt: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSubmitting(true);
    const res = await fetch("/api/cron-jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        agentId: form.triggerType === "agent" ? form.agentId : null,
        workflowId: form.triggerType === "workflow" ? form.workflowId : null,
      }),
    });
    if (res.ok) onCreated(); else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Name <span className="text-destructive">*</span></Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Daily Summary" /></div>
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Cron Schedule <span className="text-destructive">*</span></Label>
          <Input value={form.scheduleValue} onChange={(e) => setForm((f) => ({ ...f, scheduleValue: e.target.value }))} required placeholder="0 9 * * *" className="font-mono" />
          <p className="text-[11px] text-muted-foreground">5 fields: minute hour day month weekday. Example: <code>0 9 * * 1-5</code> = 9am weekdays</p>
        </div>
        <div className="space-y-2">
          <Label>Timezone</Label>
          <Input value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} placeholder="Asia/Singapore" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Prompt <span className="text-destructive">*</span></Label>
        <Textarea value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} rows={3} required placeholder="Generate a daily status report summarizing..." />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create Job"}</Button>
    </form>
  );
}
