"use client";
import { RequirePermission } from "@/components/require-permission";

import { useState, useEffect, useCallback } from "react";
import { Bot, GitBranch, Share2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FileBrowser } from "@/components/workspace/file-browser";
import type { Agent, Workflow, WorkflowRun } from "@ais-app/types";

export default function WorkspacePage() {
  const [tab, setTab] = useState("agents");

  return (
    <RequirePermission module="WORKSPACE"><>
      <PageHeader title="Workspace" description="Browse files created by agents and workflows." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="agents">Agent Workspaces</TabsTrigger>
          <TabsTrigger value="runs">Workflow Runs</TabsTrigger>
          <TabsTrigger value="shared">Shared Files</TabsTrigger>
        </TabsList>
        <TabsContent value="agents"><AgentWorkspacesTab /></TabsContent>
        <TabsContent value="runs"><WorkflowRunsTab /></TabsContent>
        <TabsContent value="shared"><SharedFilesTab /></TabsContent>
      </Tabs>
    </></RequirePermission>
  );
}

function AgentWorkspacesTab() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents?pageSize=100")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setAgents(d.data); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground">Agents</p>
        </div>
        <div className="overflow-y-auto max-h-[600px]">
          {loading ? (
            <div className="p-3 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : agents.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No agents configured.</p>
          ) : (
            agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`flex items-center gap-2 w-full px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0 ${selectedId === a.id ? "bg-muted" : ""}`}
              >
                <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{a.name}</div>
                  <div className="text-[10px] text-muted-foreground">{a.slug}</div>
                </div>
                <Badge variant={a.status === "active" ? "success" : "secondary"} className="text-[9px] shrink-0">{a.status}</Badge>
              </button>
            ))
          )}
        </div>
      </Card>

      <div>
        {selectedId ? (
          <FileBrowser scope="agent" id={selectedId} />
        ) : (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            Select an agent to browse its workspace files.
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowRunsTab() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWfId, setSelectedWfId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);

  useEffect(() => {
    fetch("/api/workflows?pageSize=50")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setWorkflows(d.data); })
      .finally(() => setLoading(false));
  }, []);

  const fetchRuns = useCallback(async (wfId: string) => {
    setLoadingRuns(true);
    setSelectedRunId(null);
    const res = await fetch(`/api/workflows/${wfId}/runs?pageSize=20`);
    if (res.ok) { const d = await res.json(); setRuns(d.data || []); }
    setLoadingRuns(false);
  }, []);

  function selectWorkflow(wfId: string) {
    setSelectedWfId(wfId);
    fetchRuns(wfId);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground">
            {selectedWfId ? "Runs" : "Workflows"}
          </p>
          {selectedWfId && (
            <button onClick={() => { setSelectedWfId(null); setSelectedRunId(null); setRuns([]); }} className="text-[10px] text-primary hover:underline">
              Back to workflows
            </button>
          )}
        </div>
        <div className="overflow-y-auto max-h-[600px]">
          {loading ? (
            <div className="p-3 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : !selectedWfId ? (
            workflows.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No workflows configured.</p>
            ) : (
              workflows.map((w) => (
                <button
                  key={w.id}
                  onClick={() => selectWorkflow(w.id)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
                >
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate flex-1">{w.name}</span>
                </button>
              ))
            )
          ) : loadingRuns ? (
            <div className="p-3 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : runs.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No runs for this workflow.</p>
          ) : (
            runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRunId(r.id)}
                className={`flex items-center gap-2 w-full px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0 ${selectedRunId === r.id ? "bg-muted" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs truncate">{r.id.slice(0, 8)}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                </div>
                <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "error" : "secondary"} className="text-[9px] shrink-0">{r.status}</Badge>
              </button>
            ))
          )}
        </div>
      </Card>

      <div>
        {selectedRunId ? (
          <FileBrowser scope="run" id={selectedRunId} />
        ) : (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            {selectedWfId ? "Select a run to browse its workspace files." : "Select a workflow, then a run."}
          </div>
        )}
      </div>
    </div>
  );
}

function SharedFilesTab() {
  return <FileBrowser scope="shared" />;
}
