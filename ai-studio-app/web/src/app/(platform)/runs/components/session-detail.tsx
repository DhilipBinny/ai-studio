"use client";
import { useState, useEffect, useCallback } from "react";
import {
  MessageSquare, ArrowLeft, Clock, Cpu, Wrench, AlertCircle,
  ChevronDown, ChevronRight, Zap, Timer,
  CheckCircle2, XCircle, Loader2, DollarSign, FolderOpen,
  Hash,
} from "lucide-react";
import { FileBrowser } from "@/components/workspace/file-browser";
import { EventFeed, HistoricalEventFeed } from "@/components/activity/event-feed";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { SessionDetail, SessionToolCall } from "@ais-app/types";
import { MessageRow } from "./message-row";

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

export function SessionDetailView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);

  const loadSession = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/runs/${sessionId}`);
    if (res.ok) {
      setSession(await res.json());
    } else {
      setError("Failed to load session");
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  async function handleApproval(toolCallId: number, action: "approve" | "deny") {
    setApproving(true);
    const res = await fetch(`/api/runs/${sessionId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolCallId: String(toolCallId), action }),
    });
    if (res.ok) {
      await loadSession();
    }
    setApproving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        <div className="text-destructive text-sm">{error || "Session not found"}</div>
      </div>
    );
  }

  const totalTokens = session.totalInputTokens + session.totalOutputTokens;
  const duration = formatDuration(session.startedAt, session.completedAt);
  const sessionCost = parseFloat(session.totalCostUsd);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" /> Sessions</Button>
        <div className="flex-1" />
        <Badge variant={STATUS_VARIANT[session.status] || "secondary"} className="text-xs">{session.status}</Badge>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{session.agentName}</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{session.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MetricCard icon={Hash} label="Turns" value={String(session.totalTurns)} />
        <MetricCard icon={Wrench} label="Tool Calls" value={String(session.totalToolCalls)} />
        <MetricCard icon={Zap} label="Tokens" value={totalTokens.toLocaleString()} detail={`${session.totalInputTokens.toLocaleString()} in / ${session.totalOutputTokens.toLocaleString()} out`} />
        <MetricCard icon={DollarSign} label="Cost" value={formatCost(sessionCost)} detail={sessionCost > 0 ? `${session.totalInputTokens.toLocaleString()} in + ${session.totalOutputTokens.toLocaleString()} out` : undefined} />
        <MetricCard icon={Timer} label="Duration" value={duration} />
        <MetricCard icon={Cpu} label="Model" value={session.modelUsed || "—"} />
        <MetricCard icon={MessageSquare} label="Channel" value={CHANNEL_LABEL[session.channel] || session.channel} />
      </div>

      {session.errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">Session Error</p>
            <p className="text-xs text-destructive/80 mt-0.5">{session.errorMessage}</p>
          </div>
        </div>
      )}

      {session.status === "waiting_approval" && (() => {
        const pendingCalls = session.toolCalls.filter((tc) => tc.requiresApproval && !tc.approvalStatus);
        if (pendingCalls.length === 0) return null;
        return (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Approval Required</p>
                <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                  {pendingCalls.length} dangerous tool call{pendingCalls.length > 1 ? "s" : ""} waiting for admin approval.
                </p>
              </div>
            </div>
            {pendingCalls.map((tc) => (
              <div key={tc.id} className="flex items-center justify-between rounded-md border border-amber-200 bg-white dark:bg-card px-3 py-2">
                <div>
                  <span className="text-sm font-mono font-medium">{tc.toolName}</span>
                  <pre className="text-[11px] text-muted-foreground mt-1 max-h-16 overflow-y-auto">{JSON.stringify(tc.arguments, null, 2)}</pre>
                </div>
                <div className="flex gap-2 shrink-0 ml-4">
                  <Button size="sm" variant="outline" disabled={approving} onClick={() => handleApproval(tc.id, "deny")}>
                    <XCircle className="h-3 w-3 mr-1" /> Deny
                  </Button>
                  <Button size="sm" disabled={approving} onClick={() => handleApproval(tc.id, "approve")}>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {(session.status === "running" || session.status === "waiting_approval") ? (
        <EventFeed traceId={session.id} enabled height={350} />
      ) : (
        <HistoricalEventFeed sessionId={session.id} height={300} />
      )}

      <div className="border border-border rounded-lg">
        <div className="px-4 py-3 border-b bg-muted/30">
          <h2 className="text-sm font-semibold">Execution Timeline</h2>
          <p className="text-xs text-muted-foreground">{session.messages.length} messages, {session.toolCalls.length} tool calls</p>
        </div>
        <div className="divide-y">
          {session.messages.map((msg, idx) => (
            <MessageRow key={msg.id} message={msg} toolCalls={session.toolCalls} index={idx} />
          ))}
        </div>
      </div>

      {session.toolCalls.length > 0 && (
        <div className="border border-border rounded-lg">
          <div className="px-4 py-3 border-b bg-muted/30">
            <h2 className="text-sm font-semibold">Tool Calls Summary</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {session.toolCalls.map((tc) => (
                <TableRow key={tc.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{tc.toolName}</span>
                  </TableCell>
                  <TableCell>
                    <ToolStatusBadge status={tc.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{tc.durationMs != null ? `${tc.durationMs}ms` : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(tc.createdAt).toLocaleTimeString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <WorkspaceFilesSection agentId={session.agentId} />
    </div>
  );
}

function WorkspaceFilesSection({ agentId }: { agentId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border rounded-lg">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Workspace Files</h2>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <FileBrowser scope="agent" id={agentId} />
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-sm font-semibold truncate">{value}</p>
      {detail && <p className="text-[11px] text-muted-foreground truncate">{detail}</p>}
    </div>
  );
}

export function ToolStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "success" | "error" | "secondary" | "warning"; icon: React.ComponentType<{ className?: string }> }> = {
    success: { variant: "success", icon: CheckCircle2 },
    error: { variant: "error", icon: XCircle },
    pending: { variant: "secondary", icon: Clock },
    denied: { variant: "warning", icon: XCircle },
    timeout: { variant: "error", icon: Timer },
  };
  const c = config[status] || config.pending;
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}
