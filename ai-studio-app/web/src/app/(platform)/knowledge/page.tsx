"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { Plus, BookOpen } from "lucide-react";
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

interface KnowledgeBase { id: string; name: string; description: string; embeddingModel: string; documentCount: number; chunkCount: number; createdAt: string; }

export default function KnowledgePage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchKbs = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/knowledge-bases?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`);
    if (res.ok) { const d = await res.json(); setKbs(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchKbs(); }, [fetchKbs]);

  return (
    <RequirePermission module="KNOWLEDGE"><>
      <PageHeader title="Knowledge Bases" description="Manage document collections for RAG-powered agents.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create KB</Button>
      </PageHeader>

      {!loading && kbs.length === 0 ? (
        <EmptyState icon={BookOpen} title="No knowledge bases yet" description="Create a knowledge base to upload documents for agent RAG." actionLabel="Create KB" onAction={() => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Embedding Model</TableHead><TableHead>Documents</TableHead><TableHead>Chunks</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={5} /> : kbs.map((kb) => (
                <TableRow key={kb.id}>
                  <TableCell><div className="font-medium">{kb.name}</div>{kb.description && <div className="text-xs text-muted-foreground line-clamp-1">{kb.description}</div>}</TableCell>
                  <TableCell><Badge variant="secondary">{kb.embeddingModel}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{kb.documentCount}</TableCell>
                  <TableCell className="text-muted-foreground">{kb.chunkCount.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(kb.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Create Knowledge Base</DialogTitle></DialogHeader>
          <CreateKBForm onCreated={() => { setShowCreate(false); fetchKbs(); }} />
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function CreateKBForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", description: "", embeddingModel: "text-embedding-3-small" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSubmitting(true);
    const res = await fetch("/api/knowledge-bases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) onCreated(); else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Product Documentation" /></div>
      <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
      <div className="space-y-2"><Label>Embedding Model</Label><Input value={form.embeddingModel} onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))} /></div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
    </form>
  );
}
