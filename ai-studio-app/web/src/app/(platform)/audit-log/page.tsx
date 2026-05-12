"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";

interface AuditEntry {
  id: number;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  userId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/audit-log?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`);
    if (res.ok) {
      const d = await res.json();
      setEntries(d.data);
      setTotal(d.total);
      setTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const actionCategory = (action: string) => {
    if (action.startsWith("auth.")) return "warning";
    if (action.includes("delete") || action.includes("deactivate")) return "error";
    if (action.includes("create")) return "success";
    return "secondary";
  };

  return (
    <RequirePermission module="AUDIT"><>
      <PageHeader title="Audit Log" description="Track all actions performed in the platform." />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? <TableSkeleton columns={4} rows={10} /> : entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Badge variant={actionCategory(e.action) as "success" | "warning" | "error" | "secondary"} className="font-mono text-xs">
                    {e.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {e.resourceType ? `${e.resourceType}${e.resourceId ? ` / ${e.resourceId.slice(0, 8)}...` : ""}` : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{e.ipAddress || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />
    </></RequirePermission>
  );
}
