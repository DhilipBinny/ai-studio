"use client";
import { useState, useEffect } from "react";
import {
  Loader2, CheckCircle2, XCircle, Clock, Zap,
  ChevronDown, ChevronRight, FolderOpen,
} from "lucide-react";
import { FileBrowser } from "@/components/workspace/file-browser";
import { EventFeed, HistoricalEventFeed } from "@/components/activity/event-feed";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { formatRelativeTime } from "@/lib/utils";
import { STATUS_VARIANT } from "@/lib/constants";
import { NODE_COLOR_MAP } from "@/components/workflow/canvas-types";
import type { WorkflowRun, RunStep } from "@ais-app/types";

export function RunDetail({ workflowId, runId, onBack }: { workflowId: string; runId: string; onBack: () => void }) {
  const [run, setRun] = useState<WorkflowRun & { steps: RunStep[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/workflows/${workflowId}/runs/${runId}`).then((r) => r.ok ? r.json() : null).then((d) => { setRun(d); setLoading(false); });
  }, [workflowId, runId]);

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!run) return <div className="text-destructive">Run not found</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Runs</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Run Detail</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex-1" />
        <Badge variant={STATUS_VARIANT[run.status] || "secondary"}>{run.status}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="border border-border rounded-lg px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Steps</p>
          <p className="text-sm font-semibold">{run.steps.length}</p>
        </div>
        <div className="border border-border rounded-lg px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Duration</p>
          <p className="text-sm font-semibold">
            {run.startedAt && run.completedAt ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s` : "—"}
          </p>
        </div>
        <div className="border border-border rounded-lg px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Started</p>
          <p className="text-sm font-semibold">{formatRelativeTime(run.startedAt)}</p>
        </div>
      </div>

      {run.errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{run.errorMessage}</div>
      )}

      {(run.status === "running" || run.status === "waiting") ? (
        <EventFeed traceId={runId} enabled height={400} />
      ) : (
        <HistoricalEventFeed traceId={runId} height={350} />
      )}

      <div className="border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold">Execution Steps</h2>
        </div>
        <div className="divide-y">
          {run.steps.map((step, idx) => (
            <StepRow key={step.id} step={step} index={idx} />
          ))}
        </div>
      </div>

      {run.output && (
        <div className="border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold">Final Output</h2>
          </div>
          <pre className="p-4 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">{JSON.stringify(run.output, null, 2)}</pre>
        </div>
      )}

      <RunFilesSection runId={runId} />
    </div>
  );
}

function RunFilesSection({ runId }: { runId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border rounded-lg">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Run Files</h2>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <FileBrowser scope="run" id={runId} />
        </div>
      )}
    </div>
  );
}

function StepRow({ step, index }: { step: RunStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const color = NODE_COLOR_MAP[step.nodeType] || "#6b7280";
  const statusIcon = step.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-green-600" /> :
    step.status === "failed" ? <XCircle className="h-4 w-4 text-red-600" /> :
    step.status === "waiting_human" ? <Clock className="h-4 w-4 text-amber-600" /> :
    step.status === "running" ? <Loader2 className="h-4 w-4 text-blue-600 animate-spin" /> :
    <Zap className="h-4 w-4 text-blue-600" />;

  const durationLabel = step.durationMs != null
    ? step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`
    : null;

  return (
    <div className="border-l-3 transition-colors" style={{ borderLeftColor: color }}>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors">
        {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <span className="text-xs text-muted-foreground/60 w-5 tabular-nums">{index + 1}</span>
        {statusIcon}
        <span className="text-sm font-medium">{step.nodeName}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: `${color}15`, color }}>{step.nodeType}</span>
        {durationLabel && <span className="text-[11px] text-muted-foreground/60 ml-auto tabular-nums">{durationLabel}</span>}
      </button>
      {expanded && step.output && (
        <pre className="mx-4 mb-3 ml-16 text-[11px] font-mono bg-muted/40 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto border border-border/30 text-muted-foreground">{JSON.stringify(step.output, null, 2)}</pre>
      )}
    </div>
  );
}
