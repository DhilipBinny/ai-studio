"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";
import { formatRelativeTime } from "@/lib/utils";

import { useState, useEffect, useCallback } from "react";
import { Plus, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { WorkflowDetail } from "./components/workflow-detail";
import { CreateWorkflowForm } from "./components/create-form";
import type { Workflow } from "@ais-app/types";

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
