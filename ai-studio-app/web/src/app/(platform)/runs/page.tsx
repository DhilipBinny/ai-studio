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

interface Session {
  id: string;
  agentName: string;
  status: string;
  channel: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTurns: number;
  totalCostUsd: string;
  modelUsed: string | null;
  startedAt: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "info" | "success" | "error" | "warning" | "secondary"> = {
  pending: "secondary", running: "info", waiting: "info", completed: "success", failed: "error", cancelled: "warning", timeout: "error",
};

const CHANNEL_LABEL: Record<string, string> = {
  studio: "Studio", api: "API", embedded: "Embedded", workflow: "Workflow", connector: "Connector",
};

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/runs?${params}`);
    if (res.ok) { const d = await res.json(); setSessions(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  return (
    <RequirePermission module="RUNS"><>
      <PageHeader title="Sessions" description="View agent conversation sessions and usage." />

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-40">
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="waiting">Waiting</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {!loading && sessions.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No sessions yet" description="Chat with an agent or call the API to see sessions here." />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Turns</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={6} /> : sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.agentName}</div>
                    {s.modelUsed && <div className="text-xs text-muted-foreground">{s.modelUsed}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{CHANNEL_LABEL[s.channel] || s.channel}</Badge></TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[s.status] || "secondary"}>{s.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{s.totalTurns}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{s.totalInputTokens.toLocaleString()}↑ {s.totalOutputTokens.toLocaleString()}↓</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}</TableCell>
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
