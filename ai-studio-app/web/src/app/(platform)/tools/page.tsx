"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { Plus, Wrench, Pencil, Loader2, Filter } from "lucide-react";
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

interface Tool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  toolType: string;
  category: string;
  riskLevel: string;
  version: number;
  isActive: boolean;
  createdAt: string;
}

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, { label: string; className: string }> = {
    safe: { label: "Safe", className: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300" },
    moderate: { label: "Moderate", className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300" },
    dangerous: { label: "Dangerous", className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300" },
  };
  const c = config[level] || { label: level, className: "" };
  return <Badge variant="outline" className={c.className}>{c.label}</Badge>;
}

const TOOL_TYPES = [
  { value: "custom", label: "Custom" },
  { value: "builtin", label: "Builtin" },
  { value: "mcp", label: "MCP" },
  { value: "api", label: "API" },
  { value: "code", label: "Code" },
];

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTool, setEditTool] = useState<Tool | null>(null);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/tools?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`);
    if (res.ok) {
      const d = await res.json();
      setTools(d.data);
      setTotal(d.total);
      setTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  return (
    <RequirePermission module="TOOLS"><>
      <PageHeader title="Tools" description="Register and manage tools that agents can use.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Add Tool</Button>
      </PageHeader>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{total} tool{total !== 1 ? "s" : ""}</span>
      </div>

      {!loading && tools.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools yet" description="Register your first tool to give agents capabilities." actionLabel="Add Tool" onAction={() => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Version</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={6} /> : tools.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.displayName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.name}</div>
                    {t.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t.description}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{t.toolType}</Badge></TableCell>
                  <TableCell><RiskBadge level={t.riskLevel} /></TableCell>
                  <TableCell className="text-muted-foreground">{t.category || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">v{t.version}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditTool(t)} aria-label="Edit tool">
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={showCreate} onOpenChange={setShowCreate} size="xl">
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Add Tool</DialogTitle></DialogHeader>
          <CreateToolForm onCreated={() => { setShowCreate(false); fetchTools(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTool} onOpenChange={(open) => { if (!open) setEditTool(null); }} size="xl">
        <DialogContent onClose={() => setEditTool(null)}>
          <DialogHeader><DialogTitle>Edit Tool</DialogTitle></DialogHeader>
          {editTool && <EditToolForm tool={editTool} onSaved={() => { setEditTool(null); fetchTools(); }} />}
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function CreateToolForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", displayName: "", description: "", toolType: "custom", category: "general" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) onCreated();
    else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2">
        <Label>Machine Name <span className="text-destructive">*</span></Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required pattern="[a-z][a-z0-9_]*" placeholder="web_search" />
        <p className="text-xs text-muted-foreground">Lowercase with underscores. Used in code.</p>
      </div>
      <div className="space-y-2">
        <Label>Display Name <span className="text-destructive">*</span></Label>
        <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} required placeholder="Web Search" />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What does this tool do?" rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={form.toolType} onChange={(e) => setForm((f) => ({ ...f, toolType: e.target.value }))}>
            {TOOL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="general" />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create"}
      </Button>
    </form>
  );
}

function EditToolForm({ tool, onSaved }: { tool: Tool; onSaved: () => void }) {
  const [form, setForm] = useState({
    displayName: tool.displayName,
    description: tool.description || "",
    category: tool.category || "general",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const body: Record<string, unknown> = {};
    if (form.displayName !== tool.displayName) body.displayName = form.displayName;
    if (form.description !== (tool.description || "")) body.description = form.description;
    if (form.category !== (tool.category || "general")) body.category = form.category;

    if (Object.keys(body).length === 0) {
      setError("No changes to save.");
      setSubmitting(false);
      return;
    }

    const res = await fetch(`/api/tools/${tool.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) onSaved();
    else { const d = await res.json(); setError(d.error || "Failed to update"); }
    setSubmitting(false);
  }

  async function handleDeactivate() {
    setDeactivating(true);
    const res = await fetch(`/api/tools/${tool.id}/deactivate`, { method: "POST" });
    if (res.ok) onSaved();
    else { const d = await res.json(); setError(d.error || "Failed to deactivate"); }
    setDeactivating(false);
    setConfirmDeactivate(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="space-y-1">
        <p className="text-sm font-mono text-muted-foreground">{tool.name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Type: {tool.toolType}</span>
          <span>&middot;</span>
          <RiskBadge level={tool.riskLevel} />
          <span>&middot;</span>
          <span>v{tool.version}</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Display Name <span className="text-destructive">*</span></Label>
        <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} required />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
        </Button>
        {!confirmDeactivate ? (
          <Button type="button" variant="outline" onClick={() => setConfirmDeactivate(true)}>
            Delete
          </Button>
        ) : (
          <Button type="button" variant="destructive" onClick={handleDeactivate} disabled={deactivating}>
            {deactivating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Delete"}
          </Button>
        )}
      </div>
    </form>
  );
}
