"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";
import { formatRelativeTime } from "@/lib/utils";

import { useState, useEffect, useCallback } from "react";
import { Plus, Plug, Pencil, Loader2, Trash2, TestTube, Check, Wrench } from "lucide-react";
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

interface DiscoveredTool { name: string; description: string; }
interface Connector {
  id: string; name: string; description: string; connectorType: string;
  connectionConfig: Record<string, unknown>; status: string;
  lastTestedAt: string | null; lastError: string | null; createdAt: string;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "secondary"> = {
  active: "success", inactive: "warning", error: "error", testing: "secondary",
};

export default function ConnectorsPage() {
  const [connectorsList, setConnectorsList] = useState<Connector[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editConnector, setEditConnector] = useState<Connector | null>(null);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/connectors?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`);
    if (res.ok) { const d = await res.json(); setConnectorsList(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchConnectors(); }, [fetchConnectors]);

  return (
    <RequirePermission module="CONNECTORS"><>
      <PageHeader title="Connectors" description="Connect to external systems via MCP, REST API, databases, and webhooks.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Add Connector</Button>
      </PageHeader>

      {!loading && connectorsList.length === 0 ? (
        <EmptyState icon={Plug} title="No connectors yet" description="Add an MCP connector to give agents access to external tools like GitHub, Slack, or databases." actionLabel="Add Connector" onAction={() => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Last Tested</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={6} /> : connectorsList.map((c) => {
                const tools = (c.connectionConfig?.discoveredTools as DiscoveredTool[]) || [];
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      {c.description && <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{c.connectorType === "mcp" ? "MCP" : c.connectorType}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status] || "secondary"}>{c.status}</Badge>
                      {c.lastError && <p className="text-xs text-destructive mt-0.5 line-clamp-1">{c.lastError}</p>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tools.length > 0 ? tools.length : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.lastTestedAt ? formatRelativeTime(c.lastTestedAt) : "Never"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditConnector(c)} aria-label="Edit connector">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={showCreate} onOpenChange={setShowCreate} size="xl">
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Add Connector</DialogTitle></DialogHeader>
          <CreateConnectorForm onCreated={() => { setShowCreate(false); fetchConnectors(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editConnector} onOpenChange={(open) => { if (!open) setEditConnector(null); }} size="xl">
        <DialogContent onClose={() => setEditConnector(null)}>
          <DialogHeader><DialogTitle>Connector Details</DialogTitle></DialogHeader>
          {editConnector && <ConnectorDetail connector={editConnector} onUpdated={() => { setEditConnector(null); fetchConnectors(); }} />}
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function CreateConnectorForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", connectorType: "mcp", description: "",
    command: "", args: "", env: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const connectionConfig: Record<string, unknown> = {};
    if (form.connectorType === "mcp") {
      if (!form.command.trim()) { setError("Command is required for MCP connectors"); setSubmitting(false); return; }
      connectionConfig.transport = "stdio";
      connectionConfig.command = form.command.trim();
      connectionConfig.args = form.args.trim() ? form.args.split(/\s+/) : [];
      if (form.env.trim()) {
        const envPairs: Record<string, string> = {};
        for (const line of form.env.split("\n")) {
          const [key, ...valueParts] = line.split("=");
          if (key?.trim()) envPairs[key.trim()] = valueParts.join("=").trim();
        }
        connectionConfig.env = envPairs;
      }
    }

    const res = await fetch("/api/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        connectorType: form.connectorType,
        connectionConfig,
      }),
    });
    if (res.ok) onCreated();
    else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="GitHub" />
      </div>
      <div className="space-y-2">
        <Label>Type</Label>
        <Select value={form.connectorType} onChange={(e) => setForm((f) => ({ ...f, connectorType: e.target.value }))}>
          <option value="mcp">MCP (Model Context Protocol)</option>
          <option value="rest_api">REST API</option>
          <option value="database">Database</option>
          <option value="webhook">Webhook</option>
          <option value="graphql">GraphQL</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="GitHub integration for repo and issue management" />
      </div>

      {form.connectorType === "mcp" && (
        <div className="border border-border rounded-lg p-3 space-y-3">
          <p className="text-sm font-medium">MCP Server Configuration</p>
          <div className="space-y-2">
            <Label className="text-xs">Command <span className="text-destructive">*</span></Label>
            <Input value={form.command} onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))} placeholder="npx" />
            <p className="text-xs text-muted-foreground">The command to spawn the MCP server subprocess.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Arguments</Label>
            <Input value={form.args} onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" />
            <p className="text-xs text-muted-foreground">Space-separated arguments for the command.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Environment Variables</Label>
            <Textarea value={form.env} onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))} rows={3} placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx&#10;ANOTHER_VAR=value" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">One per line, KEY=VALUE format. Used to pass API keys to the MCP server.</p>
          </div>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create"}
      </Button>
    </form>
  );
}

function ConnectorDetail({ connector, onUpdated }: { connector: Connector; onUpdated: () => void }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; tools?: DiscoveredTool[]; error?: string; latencyMs?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const discoveredTools = (connector.connectionConfig?.discoveredTools as DiscoveredTool[]) || [];
  const config = connector.connectionConfig || {};

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch(`/api/connectors/${connector.id}/test`, { method: "POST" });
    const result = await res.json();
    setTestResult(result);
    setTesting(false);
    if (result.success) onUpdated();
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/connectors/${connector.id}`, { method: "DELETE" });
    if (res.ok) onUpdated();
    setDeleting(false);
    setConfirmDelete(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{connector.name}</p>
          <p className="text-xs text-muted-foreground">{connector.connectorType} &middot; <Badge variant={STATUS_VARIANT[connector.status] || "secondary"} className="text-[10px]">{connector.status}</Badge></p>
        </div>
        {connector.connectorType === "mcp" && (
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <TestTube className="h-3 w-3 mr-1" />}
            {testing ? "Testing..." : "Test Connection"}
          </Button>
        )}
      </div>

      {connector.connectorType === "mcp" && (
        <div className="rounded-md bg-muted/50 p-3 space-y-1 text-xs font-mono">
          <p><span className="text-muted-foreground">command:</span> {config.command as string || "—"}</p>
          <p><span className="text-muted-foreground">args:</span> {(config.args as string[])?.join(" ") || "—"}</p>
          {config.env && Object.keys(config.env as Record<string, string>).length > 0 && (
            <p><span className="text-muted-foreground">env:</span> {Object.keys(config.env as Record<string, string>).join(", ")}</p>
          )}
        </div>
      )}

      {testResult && (
        <div className={`rounded-md px-3 py-2 text-xs ${testResult.success ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {testResult.success
            ? `Connected in ${testResult.latencyMs}ms — ${testResult.tools?.length || 0} tools discovered`
            : `Failed: ${testResult.error}`}
        </div>
      )}

      {discoveredTools.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Wrench className="h-3 w-3" />
            {discoveredTools.length} tools discovered
          </div>
          <div className="rounded-md border border-border max-h-48 overflow-y-auto">
            {discoveredTools.map((t) => (
              <div key={t.name} className="flex items-start gap-2 px-2.5 py-1.5 border-b last:border-b-0">
                <span className="text-xs font-mono font-medium shrink-0">{t.name}</span>
                <span className="text-xs text-muted-foreground line-clamp-1">{t.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t">
        {!confirmDelete ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
        ) : (
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm Delete"}
          </Button>
        )}
      </div>
    </div>
  );
}
