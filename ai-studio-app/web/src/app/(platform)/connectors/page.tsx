"use client";
import { RequirePermission } from "@/components/require-permission";

import { useState, useEffect, useCallback } from "react";
import { Plus, Plug } from "lucide-react";
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

interface Connector { id: string; name: string; description: string; connectorType: string; status: string; lastTestedAt: string | null; createdAt: string; }
const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "info"> = { active: "success", inactive: "warning", error: "error", testing: "info" };

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/connectors?page=${page}&pageSize=20`);
    if (res.ok) { const d = await res.json(); setConnectors(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchConnectors(); }, [fetchConnectors]);

  return (
    <RequirePermission module="CONNECTORS"><>
      <PageHeader title="Connectors" description="Connect to external systems like TK3 and MVMS.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Add Connector</Button>
      </PageHeader>
      {!loading && connectors.length === 0 ? (
        <EmptyState icon={Plug} title="No connectors yet" description="Add a connector to integrate with external systems." actionLabel="Add Connector" onAction={() => setShowCreate(true)} />
      ) : (
        <Card><Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Last Tested</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading ? <TableSkeleton columns={4} /> : connectors.map((c) => (
              <TableRow key={c.id}>
                <TableCell><div className="font-medium">{c.name}</div>{c.description && <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>}</TableCell>
                <TableCell><Badge variant="secondary">{c.connectorType.replace("_", " ")}</Badge></TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[c.status] || "secondary"}>{c.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{c.lastTestedAt ? new Date(c.lastTestedAt).toLocaleString() : "Never"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></Card>
      )}
      <Pagination page={page} pageSize={20} total={total} totalPages={totalPages} onPageChange={setPage} />
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Add Connector</DialogTitle></DialogHeader>
          <CreateConnectorForm onCreated={() => { setShowCreate(false); fetchConnectors(); }} />
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function CreateConnectorForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", connectorType: "database", description: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSubmitting(true);
    const res = await fetch("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) onCreated(); else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="TK3 Database" /></div>
      <div className="space-y-2"><Label>Type</Label>
        <Select value={form.connectorType} onChange={(e) => setForm((f) => ({ ...f, connectorType: e.target.value }))}>
          <option value="database">Database</option><option value="rest_api">REST API</option><option value="mcp">MCP</option><option value="webhook">Webhook</option><option value="graphql">GraphQL</option>
        </Select>
      </div>
      <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
    </form>
  );
}
