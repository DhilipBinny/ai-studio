"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";

interface Run { id: string; agentName: string; status: string; triggerType: string; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: string; startedAt: string | null; createdAt: string; }

const STATUS_VARIANT: Record<string, "info" | "success" | "error" | "warning" | "secondary"> = {
  pending: "secondary", running: "info", completed: "success", failed: "error", cancelled: "warning", timeout: "error",
};

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/runs?${params}`);
    if (res.ok) { const d = await res.json(); setRuns(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  return (
    <RequirePermission module="RUNS"><>
      <PageHeader title="Runs" description="View agent execution history and results." />

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-40">
          <option value="">All statuses</option>
          <option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {!loading && runs.length === 0 ? (
        <EmptyState icon={Play} title="No agent runs yet" description="Run an agent to see execution history here." />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={5} /> : runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.agentName}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] || "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{(r.totalInputTokens + r.totalOutputTokens).toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">${Number(r.totalCostUsd).toFixed(4)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</TableCell>
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
