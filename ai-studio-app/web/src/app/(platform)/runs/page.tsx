"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import type { Session } from "@ais-app/types";
import { SessionDetailView } from "./components/session-detail";

const STATUS_VARIANT: Record<string, "info" | "success" | "error" | "warning" | "secondary"> = {
  pending: "secondary", running: "info", waiting: "info", waiting_approval: "warning", completed: "success", failed: "error", cancelled: "warning", timeout: "error",
};

const CHANNEL_LABEL: Record<string, string> = {
  studio: "Studio", api: "API", embedded: "Embedded", workflow: "Workflow", connector: "Connector",
};

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/agents?pageSize=100");
    if (res.ok) { const d = await res.json(); setAgents(d.data.map((a: Record<string, string>) => ({ id: a.id, name: a.name }))); }
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    if (agentFilter) params.set("agentId", agentFilter);
    const res = await fetch(`/api/runs?${params}`);
    if (res.ok) { const d = await res.json(); setSessions(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page, statusFilter, agentFilter]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);
  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  if (selectedSessionId) {
    return (
      <RequirePermission module="RUNS">
        <SessionDetailView sessionId={selectedSessionId} onBack={() => setSelectedSessionId(null)} />
      </RequirePermission>
    );
  }

  return (
    <RequirePermission module="RUNS"><>
      <PageHeader title="Sessions" description="Agent conversation sessions, tool calls, and usage analytics." />

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-36">
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="waiting">Waiting</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select value={agentFilter} onChange={(e) => { setAgentFilter(e.target.value); setPage(1); }} className="w-48">
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        {(statusFilter || agentFilter) && (
          <button onClick={() => { setStatusFilter(""); setAgentFilter(""); setPage(1); }} className="text-xs text-muted-foreground hover:text-foreground">
            Clear filters
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{total} session{total !== 1 ? "s" : ""}</span>
      </div>

      {!loading && sessions.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No sessions found" description={statusFilter || agentFilter ? "Try adjusting your filters." : "Chat with an agent or call the API to create sessions."} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Turns</TableHead>
                <TableHead>Tool Calls</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={9} /> : sessions.map((s) => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedSessionId(s.id)}>
                  <TableCell>
                    <div className="font-medium">{s.agentName}</div>
                    {s.modelUsed && <div className="text-xs text-muted-foreground">{s.modelUsed}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{CHANNEL_LABEL[s.channel] || s.channel}</Badge></TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[s.status] || "secondary"}>{s.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{s.totalTurns}</TableCell>
                  <TableCell className="text-muted-foreground">{s.totalToolCalls || 0}</TableCell>
                  <TableCell className="text-muted-foreground text-xs font-mono">{(s.totalInputTokens + s.totalOutputTokens).toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground text-xs font-mono">{formatCost(parseFloat(s.totalCostUsd))}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{formatDuration(s.startedAt, s.completedAt)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{formatTime(s.startedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />
    </></RequirePermission>
  );
}
