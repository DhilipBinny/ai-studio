"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";
import { formatRelativeTime } from "@/lib/utils";
import { WorkflowCanvas } from "@/components/workflow/canvas";

import { useState, useEffect, useCallback } from "react";
import {
  Plus, GitBranch, ArrowLeft, Play, Pencil, Trash2, Loader2,
  CheckCircle2, XCircle, Clock, Zap, ChevronDown, ChevronRight, FolderOpen,
} from "lucide-react";
import { FileBrowser } from "@/components/workspace/file-browser";
import { EventFeed, HistoricalEventFeed } from "@/components/activity/event-feed";
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
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowRun, RunStep, AgentSummary, ProviderModel } from "@ais-app/types";

type Agent = AgentSummary;

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "error" | "info"> = {
  draft: "warning", active: "success", disabled: "secondary", archived: "error",
  pending: "secondary", running: "info", waiting: "warning", completed: "success", failed: "error", cancelled: "secondary",
};

const NODE_TYPES = [
  { value: "input", label: "Input", description: "Entry point" },
  { value: "agent", label: "Agent", description: "Run an agent session" },
  { value: "condition", label: "Condition", description: "Branch based on expression" },
  { value: "transform", label: "Transform", description: "Map/reshape data" },
  { value: "human_review", label: "Human Review", description: "Pause for approval" },
  { value: "output", label: "Output", description: "Final result" },
];

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/workflows?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`);
    if (res.ok) { const d = await res.json(); setWorkflows(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  if (selectedId) {
    return (
      <RequirePermission module="WORKFLOWS">
        <WorkflowDetail workflowId={selectedId} onBack={() => { setSelectedId(null); fetchWorkflows(); }} />
      </RequirePermission>
    );
  }

  return (
    <RequirePermission module="WORKFLOWS"><>
      <PageHeader title="Workflows" description="Build and manage multi-step agent workflows.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create Workflow</Button>
      </PageHeader>
      {!loading && workflows.length === 0 ? (
        <EmptyState icon={GitBranch} title="No workflows yet" description="Create a workflow to chain agents and tools together." actionLabel="Create Workflow" onAction={() => setShowCreate(true)} />
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-4 h-28 animate-pulse bg-muted/30" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedId(w.id)}
              className="border border-border rounded-xl p-4 text-left hover:shadow-md hover:border-border/80 transition-all cursor-pointer group bg-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-primary/5">
                    <GitBranch className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{w.name}</div>
                    {w.description && <div className="text-xs text-muted-foreground truncate mt-0.5">{w.description}</div>}
                  </div>
                </div>
                <div className={`shrink-0 w-2 h-2 rounded-full mt-1.5 ${
                  w.status === "active" ? "bg-green-500" : w.status === "draft" ? "bg-amber-500" : "bg-gray-400"
                }`} />
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50">
                <span className="text-[11px] text-muted-foreground">v{w.version}</span>
                <span className="text-[11px] text-muted-foreground">{formatRelativeTime(w.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />
      <Dialog open={showCreate} onOpenChange={setShowCreate} size="xl">
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Create Workflow</DialogTitle></DialogHeader>
          <CreateWorkflowForm onCreated={() => { setShowCreate(false); fetchWorkflows(); }} />
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function CreateWorkflowForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSubmitting(true);
    const res = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) onCreated(); else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Name <span className="text-destructive">*</span></Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Document Review Pipeline" /></div>
      <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Chain agents to review, classify, and summarize documents" /></div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
    </form>
  );
}

function WorkflowDetail({ workflowId, onBack }: { workflowId: string; onBack: () => void }) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"nodes" | "runs">("nodes");
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState("{}");
  const [showRun, setShowRun] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    const [wfRes, agentsRes, runsRes, modelsRes] = await Promise.all([
      fetch(`/api/workflows/${workflowId}`),
      fetch("/api/agents?pageSize=100"),
      fetch(`/api/workflows/${workflowId}/runs?pageSize=20`),
      fetch("/api/models"),
    ]);
    if (wfRes.ok) {
      const d = await wfRes.json();
      setWorkflow(d);
      setNodes(d.nodes || []);
      setEdges(d.edges || []);
    }
    if (agentsRes.ok) { const d = await agentsRes.json(); setAgents(d.data || []); }
    if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.data || []); }
    if (modelsRes.ok) { const d = await modelsRes.json(); setModels(d.data || []); }
    setLoading(false);
  }, [workflowId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  async function handleTrigger() {
    setRunning(true);
    try {
      const input = JSON.parse(runInput);
      const res = await fetch(`/api/workflows/${workflowId}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (res.ok) {
        setShowRun(false);
        setRunInput("{}");
        await fetchDetail();
        setTab("runs");
      }
    } catch { /* invalid JSON */ }
    setRunning(false);
  }

  async function handleSaveNodes(updatedNodes: WorkflowNode[]) {
    await fetch(`/api/workflows/${workflowId}/nodes`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: updatedNodes.map((n) => ({ nodeType: n.nodeType, name: n.name, config: n.config, positionX: n.positionX, positionY: n.positionY })) }),
    });
    await fetchDetail();
  }

  async function handleSaveEdges(updatedEdges: Array<{ fromNodeId: string; toNodeId: string; conditionExpr?: string; conditionLabel?: string; edgeType?: string }>) {
    await fetch(`/api/workflows/${workflowId}/edges`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edges: updatedEdges }),
    });
    await fetchDetail();
  }

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!workflow) return <div className="text-destructive">Workflow not found</div>;

  if (selectedRun) {
    return <RunDetail workflowId={workflowId} runId={selectedRun} onBack={() => { setSelectedRun(null); fetchDetail(); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Workflows</Button>
        <div className="flex-1" />
        <Badge variant={STATUS_VARIANT[workflow.status] || "secondary"}>{workflow.status}</Badge>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{workflow.name}</h1>
          {workflow.description && <p className="text-sm text-muted-foreground mt-0.5">{workflow.description}</p>}
        </div>
        <div className="flex gap-2">
          {workflow.status === "active" && (
            <Button size="sm" onClick={() => setShowRun(true)}><Play className="h-3 w-3 mr-1" /> Run</Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b">
        <button onClick={() => setTab("nodes")} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "nodes" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Nodes ({nodes.length})
        </button>
        <button onClick={() => setTab("runs")} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "runs" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Runs ({runs.length})
        </button>
      </div>

      {tab === "nodes" && (
        <WorkflowCanvas
          nodes={nodes}
          edges={edges}
          agents={agents}
          models={models}
          onSave={async (updatedNodes, updatedEdges) => {
            await handleSaveNodes(updatedNodes as WorkflowNode[]);
            await handleSaveEdges(updatedEdges);
          }}
        />
      )}

      {tab === "runs" && (
        runs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No runs yet. Trigger a run to see results.</div>
        ) : (
          <Card><Table>
            <TableHeader><TableRow>
              <TableHead>Status</TableHead><TableHead>Started</TableHead><TableHead>Duration</TableHead><TableHead>Error</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedRun(r.id)}>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] || "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRelativeTime(r.startedAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.startedAt && r.completedAt ? `${Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-destructive max-w-48 truncate">{r.errorMessage || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></Card>
        )
      )}

      <Dialog open={showRun} onOpenChange={setShowRun} size="xl">
        <DialogContent onClose={() => setShowRun(false)}>
          <DialogHeader><DialogTitle>Run Workflow</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Input (JSON)</Label>
              <Textarea value={runInput} onChange={(e) => setRunInput(e.target.value)} rows={5} className="font-mono text-xs" placeholder='{"text": "Document to process..."}' />
            </div>
            <Button onClick={handleTrigger} disabled={running} className="w-full">
              {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running...</> : <><Play className="h-4 w-4 mr-2" /> Trigger Run</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NodeEditor({ nodes, edges, agents, allNodes, onSaveNodes, onSaveEdges }: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  agents: Agent[];
  allNodes: WorkflowNode[];
  onSaveNodes: (nodes: WorkflowNode[]) => Promise<void>;
  onSaveEdges: (edges: Array<{ fromNodeId: string; toNodeId: string; conditionExpr?: string }>) => Promise<void>;
}) {
  const [editNodes, setEditNodes] = useState(nodes);
  const [saving, setSaving] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNode, setNewNode] = useState({ nodeType: "agent", name: "", agentId: "", message: "" });

  useEffect(() => { setEditNodes(nodes); }, [nodes]);

  async function handleAddNode() {
    if (!newNode.name) return;
    const config: Record<string, unknown> = {};
    if (newNode.nodeType === "agent") {
      config.agentId = newNode.agentId;
      config.message = newNode.message;
    }
    const updated = [...editNodes, {
      id: `temp-${Date.now()}`,
      nodeType: newNode.nodeType,
      name: newNode.name,
      config,
      positionX: editNodes.length * 200,
      positionY: 0,
    }];
    setSaving(true);
    await onSaveNodes(updated);
    setSaving(false);
    setShowAddNode(false);
    setNewNode({ nodeType: "agent", name: "", agentId: "", message: "" });
  }

  async function handleRemoveNode(idx: number) {
    const updated = editNodes.filter((_, i) => i !== idx);
    setSaving(true);
    await onSaveNodes(updated);
    setSaving(false);
  }

  async function handleAutoEdges() {
    if (editNodes.length < 2) return;
    const autoEdges = editNodes.slice(0, -1).map((n, i) => ({
      fromNodeId: n.id,
      toNodeId: editNodes[i + 1].id,
    }));
    setSaving(true);
    await onSaveEdges(autoEdges);
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{editNodes.length} node{editNodes.length !== 1 ? "s" : ""}, {edges.length} edge{edges.length !== 1 ? "s" : ""}</p>
        <div className="flex gap-2">
          {editNodes.length >= 2 && edges.length === 0 && (
            <Button variant="outline" size="sm" onClick={handleAutoEdges} disabled={saving}>Auto-connect</Button>
          )}
          <Button size="sm" onClick={() => setShowAddNode(true)}><Plus className="h-3 w-3 mr-1" /> Add Node</Button>
        </div>
      </div>

      {editNodes.length === 0 ? (
        <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground text-sm">
          No nodes yet. Add an Input node to start.
        </div>
      ) : (
        <div className="space-y-2">
          {editNodes.map((node, idx) => {
            const outEdge = edges.find((e) => e.fromNodeId === node.id);
            const targetNode = outEdge ? allNodes.find((n) => n.id === outEdge.toNodeId) : null;
            return (
              <div key={node.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{node.nodeType}</Badge>
                    <span className="text-sm font-medium">{node.name}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleRemoveNode(idx)} aria-label="Remove node">
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
                {node.nodeType === "agent" && (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Agent: {agents.find((a) => a.id === (node.config as Record<string, unknown>).agentId)?.name || "Not set"}
                    {(node.config as Record<string, unknown>).message ? (
                      <div className="mt-0.5 font-mono bg-muted/50 rounded px-1.5 py-0.5 truncate">{String((node.config as Record<string, unknown>).message)}</div>
                    ) : null}
                  </div>
                )}
                {targetNode && (
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    → {targetNode.name} {outEdge?.conditionExpr && <span className="font-mono">({outEdge.conditionExpr})</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showAddNode} onOpenChange={setShowAddNode} size="xl">
        <DialogContent onClose={() => setShowAddNode(false)}>
          <DialogHeader><DialogTitle>Add Node</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={newNode.nodeType} onChange={(e) => setNewNode((n) => ({ ...n, nodeType: e.target.value }))}>
                {NODE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} — {t.description}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={newNode.name} onChange={(e) => setNewNode((n) => ({ ...n, name: e.target.value }))} placeholder="Reviewer" />
            </div>
            {newNode.nodeType === "agent" && (
              <>
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select value={newNode.agentId} onChange={(e) => setNewNode((n) => ({ ...n, agentId: e.target.value }))}>
                    <option value="">Select agent...</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Message template</Label>
                  <Textarea value={newNode.message} onChange={(e) => setNewNode((n) => ({ ...n, message: e.target.value }))} rows={3} className="font-mono text-xs" placeholder="Summarize: {{input.text}}" />
                  <p className="text-[11px] text-muted-foreground">Use {"{{node_name.field}}"} to reference outputs from previous nodes.</p>
                </div>
              </>
            )}
            <Button onClick={handleAddNode} disabled={!newNode.name || saving} className="w-full">
              {saving ? "Adding..." : "Add Node"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RunDetail({ workflowId, runId, onBack }: { workflowId: string; runId: string; onBack: () => void }) {
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
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Runs</Button>
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
        <div className="px-4 py-3 border-b bg-muted/30">
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
          <div className="px-4 py-3 border-b bg-muted/30">
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

const STEP_NODE_COLORS: Record<string, string> = {
  input: "#3b82f6", output: "#10b981", condition: "#f59e0b", switch: "#ea580c",
  loop: "#6366f1", iteration: "#7c3aed", delay: "#94a3b8", sub_workflow: "#0284c7",
  agent: "#9333ea", llm: "#c026d3", knowledge_search: "#db2777",
  tool: "#0d9488", http_request: "#0891b2", code: "#475569",
  transform: "#0e7490", aggregate: "#059669", human_review: "#dc2626",
};

function StepRow({ step, index }: { step: RunStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const color = STEP_NODE_COLORS[step.nodeType] || "#6b7280";
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
