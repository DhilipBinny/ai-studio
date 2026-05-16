"use client";

import { Bot, Pencil, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import type { Agent, ProviderModel } from "@ais-app/types";
import { STATUS_VARIANT } from "@/lib/constants";

interface AgentListProps {
  agents: Agent[];
  total: number;
  totalPages: number;
  page: number;
  loading: boolean;
  statusFilter: string;
  models: ProviderModel[];
  onPageChange: (page: number) => void;
  onStatusFilterChange: (status: string) => void;
  onCreateClick: () => void;
  onEditClick: (agent: Agent) => void;
  onChatClick: (agent: Agent) => void;
  pageSize: number;
}

export function AgentList({
  agents, total, totalPages, page, loading, statusFilter, models,
  onPageChange, onStatusFilterChange, onCreateClick, onEditClick, onChatClick, pageSize,
}: AgentListProps) {
  function getModelLabel(modelId: string | null) {
    if (!modelId) return "—";
    const m = models.find((x) => x.id === modelId);
    return m ? `${m.displayName} (${m.providerName})` : "Unknown";
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onChange={(e) => { onStatusFilterChange(e.target.value); }} className="w-40">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {!loading && agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet" description="Create your first AI agent to get started." actionLabel="Create Agent" onAction={onCreateClick} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={5} /> : agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.slug}</div>
                    {a.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{getModelLabel(a.providerModelId)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[a.status] || "secondary"}>{a.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">v{a.version}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {a.status === "active" && a.providerModelId && (
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onChatClick(a)} title="Chat" aria-label="Chat">
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onEditClick(a)} title="Edit" aria-label="Edit">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
}
