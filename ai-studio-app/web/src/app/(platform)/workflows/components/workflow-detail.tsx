"use client";
import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Play, Loader2,
} from "lucide-react";
import { WorkflowCanvas } from "@/components/workflow/canvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatRelativeTime } from "@/lib/utils";
import { RunDetail } from "./run-detail";
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowRun, AgentSummary, ProviderModel } from "@ais-app/types";

type Agent = AgentSummary;

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "error" | "info"> = {
  draft: "warning", active: "success", disabled: "secondary", archived: "error",
  pending: "secondary", running: "info", waiting: "warning", completed: "success", failed: "error", cancelled: "secondary",
};

export function WorkflowDetail({ workflowId, onBack }: { workflowId: string; onBack: () => void }) {
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
