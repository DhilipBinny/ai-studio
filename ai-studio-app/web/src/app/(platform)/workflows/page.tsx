"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";

interface Workflow { id: string; name: string; description: string; status: string; version: number; createdAt: string; }
const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "error"> = { draft: "warning", active: "success", disabled: "secondary", archived: "error" };

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/workflows?page=${page}&pageSize=20`);
    if (res.ok) { const d = await res.json(); setWorkflows(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  return (
    <>
      <PageHeader title="Workflows" description="Build and manage multi-step agent workflows.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create Workflow</Button>
      </PageHeader>
      {!loading && workflows.length === 0 ? (
        <EmptyState icon={GitBranch} title="No workflows yet" description="Create a workflow to chain agents and tools together." actionLabel="Create Workflow" onAction={() => setShowCreate(true)} />
      ) : (
        <Card><Table>
          <TableHeader><TableRow><TableHead>Workflow</TableHead><TableHead>Status</TableHead><TableHead>Version</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading ? <TableSkeleton columns={4} /> : workflows.map((w) => (
              <TableRow key={w.id}>
                <TableCell><div className="font-medium">{w.name}</div>{w.description && <div className="text-xs text-muted-foreground line-clamp-1">{w.description}</div>}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[w.status] || "secondary"}>{w.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground">v{w.version}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(w.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></Card>
      )}
      <Pagination page={page} pageSize={20} total={total} totalPages={totalPages} onPageChange={setPage} />
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Create Workflow</DialogTitle></DialogHeader>
          <CreateWorkflowForm onCreated={() => { setShowCreate(false); fetchWorkflows(); }} />
        </DialogContent>
      </Dialog>
    </>
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
      <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Document Review Pipeline" /></div>
      <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
    </form>
  );
}
