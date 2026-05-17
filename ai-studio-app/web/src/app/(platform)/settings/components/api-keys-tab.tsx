"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Copy, Key, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { formatRelativeTime } from "@/lib/utils";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopedAgentIds: string[];
  rateLimitRpm: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/api-keys");
    if (res.ok) { const d = await res.json(); setKeys(d.data); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedKey(data.key);
      setNewKeyName("");
      fetchKeys();
    }
    setCreating(false);
  }

  async function handleRevoke(id: string) {
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    fetchKeys();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">API Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            API keys allow external systems to access agents via the REST API at <code className="bg-muted px-1 py-0.5 rounded text-xs">/api/v1/agents/:slug/sessions</code>
          </p>

          {createdKey && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
              <p className="text-sm font-medium text-green-800">API key created. Copy it now — it won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white border border-border rounded px-2 py-1 text-xs font-mono break-all">{createdKey}</code>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => { navigator.clipboard.writeText(createdKey); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCreatedKey(null)}>Dismiss</Button>
            </div>
          )}

          <div className="flex gap-2">
            <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} placeholder="Key name (e.g. TK3 Production)" className="flex-1" />
            <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Key className="h-4 w-4 mr-1" /> Create</>}
            </Button>
          </div>

          {loading ? (
            <TableSkeleton columns={5} />
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No API keys created yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id} className={!k.isActive ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{k.keyPrefix}...</TableCell>
                    <TableCell>
                      <Badge variant={k.isActive ? "success" : "secondary"}>{k.isActive ? "Active" : "Revoked"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      {k.isActive && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => handleRevoke(k.id)} aria-label="Revoke API key">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">API Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            External systems authenticate with <code className="bg-muted px-1 py-0.5 rounded text-xs">Authorization: Bearer ask_xxx</code> and call:
          </p>
          <div className="mt-3 space-y-1 font-mono text-xs bg-muted rounded-lg p-3">
            <p><span className="text-green-600">POST</span> /api/v1/agents/:slug/sessions — Create session + send message</p>
            <p><span className="text-green-600">POST</span> /api/v1/agents/:slug/sessions/:id/messages — Follow-up message</p>
            <p><span className="text-blue-600">GET</span>&nbsp; /api/v1/agents/:slug/sessions/:id/messages — Get history</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
