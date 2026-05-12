"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Bot } from "lucide-react";
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

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  version: number;
  tags: string[];
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "error"> = {
  draft: "warning", active: "success", disabled: "secondary", archived: "error",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/agents?${params}`);
    if (res.ok) {
      const data = await res.json();
      setAgents(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  return (
    <>
      <PageHeader title="Agents" description="Configure and manage your AI agents.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create Agent</Button>
      </PageHeader>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-40">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {!loading && agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet" description="Create your first AI agent to get started." actionLabel="Create Agent" onAction={() => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={5} /> : agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.slug}</div>
                  </TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[a.status] || "secondary"}>{a.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">v{a.version}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {(a.tags || []).map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={20} total={total} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Create Agent</DialogTitle></DialogHeader>
          <CreateAgentForm onCreated={() => { setShowCreate(false); fetchAgents(); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateAgentForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", slug: "", systemPrompt: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const res = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, slug }) });
    if (res.ok) onCreated();
    else { const data = await res.json(); setError(data.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="TK3 Document Reviewer" /></div>
      <div className="space-y-2"><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="Auto-generated from name" /></div>
      <div className="space-y-2"><Label>System Prompt</Label><Textarea value={form.systemPrompt} onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))} rows={4} placeholder="You are a document review assistant..." /></div>
      <div className="flex gap-3 pt-2">
        <Button type="submit" className="flex-1" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
      </div>
    </form>
  );
}
