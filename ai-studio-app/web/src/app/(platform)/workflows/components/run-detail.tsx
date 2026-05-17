"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Loader2, CheckCircle2, XCircle, Clock, Zap,
  ChevronDown, ChevronRight, FolderOpen, AlertCircle,
} from "lucide-react";
import { FileBrowser } from "@/components/workspace/file-browser";
import { EventFeed, HistoricalEventFeed } from "@/components/activity/event-feed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

  const loadRun = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/workflows/${workflowId}/runs/${runId}`);
    if (res.ok) setRun(await res.json());
    setLoading(false);
  }, [workflowId, runId]);

  useEffect(() => { loadRun(); }, [loadRun]);

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

      {run.status === "waiting" && (
        <HumanReviewPanel workflowId={workflowId} runId={runId} steps={run.steps} onResumed={loadRun} />
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
        <div className="divide-y divide-border">
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

// ---------------------------------------------------------------------------
// Human Review Approval Panel
// ---------------------------------------------------------------------------

interface ReviewConfig {
  prompt?: string;
  reviewType?: string;
  choices?: string[];
  formFields?: Array<{ key: string; label: string; type: string; options?: string[]; required?: boolean }>;
}

function HumanReviewPanel({ workflowId, runId, steps, onResumed }: {
  workflowId: string; runId: string; steps: RunStep[]; onResumed: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const waitingStep = [...steps].reverse().find((s) => s.status === "waiting_human");
  if (!waitingStep?.output) return null;

  const { prompt, reviewType, choices, formFields } = waitingStep.output as ReviewConfig;

  async function submitDecision(decision: Record<string, unknown>) {
    setSubmitting(true);
    setError("");
    const res = await fetch(`/api/workflows/${workflowId}/runs/${runId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (res.ok) {
      onResumed();
    } else {
      const d = await res.json().catch(() => null);
      setError(d?.error || "Failed to submit decision");
    }
    setSubmitting(false);
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Human Review Required</p>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
            This workflow is paused and waiting for your input.
          </p>
        </div>
      </div>

      <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-card p-4 space-y-4">
        {prompt && <p className="text-sm text-foreground whitespace-pre-wrap">{prompt}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {(!reviewType || reviewType === "approve_deny") && (
          <ApproveDenyForm submitting={submitting} onSubmit={submitDecision} />
        )}
        {reviewType === "choice" && (
          <ChoiceForm choices={choices || []} submitting={submitting} onSubmit={submitDecision} />
        )}
        {reviewType === "form" && (
          <CustomFormReview formFields={formFields || []} submitting={submitting} onSubmit={submitDecision} />
        )}
      </div>
    </div>
  );
}

function ApproveDenyForm({ submitting, onSubmit }: { submitting: boolean; onSubmit: (d: Record<string, unknown>) => void }) {
  const [comment, setComment] = useState("");
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="review-comment" className="text-xs text-muted-foreground">Comment (optional)</Label>
        <Textarea id="review-comment" placeholder="Add a reason for your decision..." value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1" rows={2} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={submitting} onClick={() => onSubmit({ approved: false, comment: comment || undefined })}>
          {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
          Deny
        </Button>
        <Button size="sm" disabled={submitting} className="bg-green-600 hover:bg-green-700 text-white" onClick={() => onSubmit({ approved: true, comment: comment || undefined })}>
          {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
          Approve
        </Button>
      </div>
    </div>
  );
}

function ChoiceForm({ choices, submitting, onSubmit }: { choices: string[]; submitting: boolean; onSubmit: (d: Record<string, unknown>) => void }) {
  const [selected, setSelected] = useState("");
  const [comment, setComment] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {choices.map((choice) => (
          <label key={choice} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="review-choice" value={choice} checked={selected === choice} onChange={() => setSelected(choice)} className="h-4 w-4 accent-primary" />
            <span className="text-sm">{choice}</span>
          </label>
        ))}
      </div>
      <div>
        <Label htmlFor="choice-comment" className="text-xs text-muted-foreground">Comment (optional)</Label>
        <Textarea id="choice-comment" placeholder="Add a comment..." value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1" rows={2} />
      </div>
      <Button size="sm" disabled={submitting || !selected} onClick={() => onSubmit({ choice: selected, comment: comment || undefined })}>
        {submitting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        Submit
      </Button>
    </div>
  );
}

function CustomFormReview({ formFields, submitting, onSubmit }: {
  formFields: Array<{ key: string; label: string; type: string; options?: string[]; required?: boolean }>;
  submitting: boolean; onSubmit: (d: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  function setValue(key: string, value: string) { setValues((prev) => ({ ...prev, [key]: value })); }

  const allRequiredFilled = formFields.filter((f) => f.required).every((f) => values[f.key]?.trim());

  return (
    <div className="space-y-3">
      {formFields.map((field) => (
        <div key={field.key}>
          <Label htmlFor={`form-${field.key}`} className="text-xs">
            {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          {field.type === "textarea" ? (
            <Textarea id={`form-${field.key}`} value={values[field.key] || ""} onChange={(e) => setValue(field.key, e.target.value)} className="mt-1" rows={3} />
          ) : field.type === "select" && field.options ? (
            <Select id={`form-${field.key}`} value={values[field.key] || ""} onChange={(e) => setValue(field.key, e.target.value)} className="mt-1">
              <option value="">Select...</option>
              {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </Select>
          ) : (
            <Input id={`form-${field.key}`} type={field.type === "number" ? "number" : "text"} value={values[field.key] || ""} onChange={(e) => setValue(field.key, e.target.value)} className="mt-1" />
          )}
        </div>
      ))}
      <Button size="sm" disabled={submitting || !allRequiredFilled} onClick={() => onSubmit(values)}>
        {submitting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        Submit
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run Files Section
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Step Row
// ---------------------------------------------------------------------------

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
