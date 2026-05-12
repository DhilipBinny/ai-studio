"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";

interface Tool { id: string; name: string; displayName: string; description: string; toolType: string; category: string; version: number; createdAt: string; }

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/tools?page=${page}&pageSize=20`);
    if (res.ok) { const d = await res.json(); setTools(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  return (
    <>
      <PageHeader title="Tools" description="Register and manage tools that agents can use.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Add Tool</Button>
      </PageHeader>

      {!loading && tools.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools yet" description="Register your first tool to give agents capabilities." actionLabel="Add Tool" onAction={() => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={4} /> : tools.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.displayName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.name}</div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{t.toolType}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{t.category}</TableCell>
                  <TableCell className="text-muted-foreground">v{t.version}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={20} total={total} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Add Tool</DialogTitle></DialogHeader>
          <CreateToolForm onCreated={() => { setShowCreate(false); fetchTools(); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateToolForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", displayName: "", toolType: "custom", category: "general" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSubmitting(true);
    const res = await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) onCreated();
    else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Machine Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required pattern="[a-z][a-z0-9_]*" placeholder="read_document" /></div>
      <div className="space-y-2"><Label>Display Name</Label><Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} required placeholder="Read Document" /></div>
      <div className="space-y-2"><Label>Type</Label>
        <Select value={form.toolType} onChange={(e) => setForm((f) => ({ ...f, toolType: e.target.value }))}>
          <option value="custom">Custom</option><option value="builtin">Builtin</option><option value="mcp">MCP</option><option value="api">API</option><option value="code">Code</option>
        </Select>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
    </form>
  );
}
