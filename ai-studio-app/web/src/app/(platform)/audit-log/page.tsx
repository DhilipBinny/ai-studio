"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";
import { formatDateTime } from "@/lib/utils";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";

interface AuditEntry {
  id: number;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  userId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  prevHash: string;
  entryHash: string;
  createdAt: string;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
              <TableHead className="w-8"></TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? <TableSkeleton columns={5} rows={10} /> : entries.map((e) => {
              const isExpanded = expandedId === e.id;
              return (
                <>
                  <TableRow
                    key={e.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedId(isExpanded ? null : e.id)}
                  >
                    <TableCell className="w-8 px-2">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionCategory(e.action) as "success" | "warning" | "error" | "secondary"} className="font-mono text-xs">
                        {e.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.resourceType ? `${e.resourceType}${e.resourceId ? ` / ${e.resourceId.slice(0, 8)}...` : ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{e.ipAddress || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(e.createdAt)}</TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow key={`${e.id}-detail`}>
                      <TableCell colSpan={5} className="bg-muted/30 px-6 py-3">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
                          <div>
                            <span className="font-medium text-muted-foreground">User ID:</span>
                            <span className="ml-2 font-mono">{e.userId || "—"}</span>
                          </div>
                          <div>
                            <span className="font-medium text-muted-foreground">Resource ID:</span>
                            <span className="ml-2 font-mono">{e.resourceId || "—"}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="font-medium text-muted-foreground">User Agent:</span>
                            <span className="ml-2 text-muted-foreground">{e.userAgent ? (e.userAgent.length > 80 ? e.userAgent.slice(0, 80) + "..." : e.userAgent) : "—"}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="font-medium text-muted-foreground">Details:</span>
                            <pre className="mt-1 rounded-md bg-background border border-border border-border p-2 font-mono text-xs overflow-auto max-h-32">
                              {JSON.stringify(e.details, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <span className="font-medium text-muted-foreground">Entry Hash:</span>
                            <span className="ml-2 font-mono text-[10px] text-muted-foreground">{e.entryHash?.slice(0, 16)}...</span>
                          </div>
                          <div>
                            <span className="font-medium text-muted-foreground">Prev Hash:</span>
                            <span className="ml-2 font-mono text-[10px] text-muted-foreground">{e.prevHash?.slice(0, 16)}...</span>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />
    </></RequirePermission>
  );
}
