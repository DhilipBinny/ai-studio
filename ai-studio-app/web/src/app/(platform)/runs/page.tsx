"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  MessageSquare, ArrowLeft, Clock, Cpu, Wrench, AlertCircle,
  ChevronDown, ChevronRight, User, Bot, Hash, Zap, Timer,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { Markdown } from "@/components/markdown";

interface Session {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  channel: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
  totalTurns: number;
  totalToolCalls: number;
  modelUsed: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface SessionDetail extends Session {
  agentSlug: string;
  providerUsed: string | null;
  errorMessage: string | null;
  triggerType: string;
  messages: SessionMessage[];
  toolCalls: SessionToolCall[];
}

interface SessionMessage {
  id: number;
  role: string;
  content: string;
  toolCalls: unknown;
  toolCallId: string | null;
  metadata: unknown;
  createdAt: string;
}

interface SessionToolCall {
  id: number;
  toolName: string;
  arguments: Record<string, unknown>;
  result: string | null;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "info" | "success" | "error" | "warning" | "secondary"> = {
  pending: "secondary", running: "info", waiting: "info", completed: "success", failed: "error", cancelled: "warning", timeout: "error",
};

const CHANNEL_LABEL: Record<string, string> = {
  studio: "Studio", api: "API", embedded: "Embedded", workflow: "Workflow", connector: "Connector",
};

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
                <TableHead>Duration</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={8} /> : sessions.map((s) => (
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

function SessionDetailView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/runs/${sessionId}`);
      if (res.ok) {
        setSession(await res.json());
      } else {
        setError("Failed to load session");
      }
      setLoading(false);
    }
    load();
  }, [sessionId]);

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

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard icon={Hash} label="Turns" value={String(session.totalTurns)} />
        <MetricCard icon={Wrench} label="Tool Calls" value={String(session.totalToolCalls)} />
        <MetricCard icon={Zap} label="Tokens" value={totalTokens.toLocaleString()} detail={`${session.totalInputTokens.toLocaleString()} in / ${session.totalOutputTokens.toLocaleString()} out`} />
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

      <div className="border rounded-lg">
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
        <div className="border rounded-lg">
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
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-sm font-semibold truncate">{value}</p>
      {detail && <p className="text-[11px] text-muted-foreground truncate">{detail}</p>}
    </div>
  );
}

function ToolStatusBadge({ status }: { status: string }) {
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

function MessageRow({ message, toolCalls, index }: { message: SessionMessage; toolCalls: SessionToolCall[]; index: number }) {
  const [expanded, setExpanded] = useState(true);

  if (message.role === "user") {
    return (
      <div className="px-4 py-3 flex gap-3">
        <div className="shrink-0 mt-0.5">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium">User</span>
            <span className="text-[11px] text-muted-foreground">{new Date(message.createdAt).toLocaleTimeString()}</span>
          </div>
          <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  if (message.role === "tool") {
    const matchingCall = toolCalls.find((tc) => {
      const blocks = findToolCallBlocks(message, toolCalls);
      return blocks.some((b) => b.id === message.toolCallId);
    }) || toolCalls.find((tc) => {
      const tcTime = new Date(tc.createdAt).getTime();
      const msgTime = new Date(message.createdAt).getTime();
      return Math.abs(tcTime - msgTime) < 5000;
    });

    return (
      <div className="px-4 py-2 bg-muted/20">
        <div className="flex gap-3">
          <div className="shrink-0 mt-0.5">
            <div className="h-7 w-7 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Wrench className="h-3.5 w-3.5 text-amber-600" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 text-xs font-medium hover:text-foreground">
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Tool Result
              {matchingCall && <span className="font-mono text-muted-foreground">({matchingCall.toolName})</span>}
              {matchingCall?.durationMs != null && <span className="text-muted-foreground ml-1">{matchingCall.durationMs}ms</span>}
              {matchingCall && <ToolStatusBadge status={matchingCall.status} />}
            </button>
            {expanded && (
              <pre className="mt-1.5 text-xs bg-muted/50 rounded-md p-2.5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono">{message.content || "(empty)"}</pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    const blocks = message.toolCalls as Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> | null;
    const hasToolCalls = blocks && blocks.some((b) => b.type === "tool_use");
    const textContent = message.content || (blocks?.filter((b) => b.type === "text").map((b) => b.text).join("") || "");
    const toolUseBlocks = blocks?.filter((b) => b.type === "tool_use") || [];

    return (
      <div className="px-4 py-3 flex gap-3">
        <div className="shrink-0 mt-0.5">
          <div className="h-7 w-7 rounded-full bg-green-500/10 flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-green-600" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium">Assistant</span>
            <span className="text-[11px] text-muted-foreground">{new Date(message.createdAt).toLocaleTimeString()}</span>
          </div>
          {textContent && (
            <Markdown content={textContent} className="prose prose-sm dark:prose-invert max-w-none" />
          )}
          {toolUseBlocks.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {toolUseBlocks.map((block) => (
                <ToolCallCard key={block.id} name={block.name || "unknown"} input={block.input as Record<string, unknown>} toolCalls={toolCalls} callId={block.id} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-2 text-xs text-muted-foreground">
      <span className="uppercase tracking-wide">{message.role}</span>: {message.content?.slice(0, 200)}
    </div>
  );
}

function ToolCallCard({ name, input, toolCalls, callId }: { name: string; input: Record<string, unknown>; toolCalls: SessionToolCall[]; callId?: string }) {
  const [showArgs, setShowArgs] = useState(false);
  const matchingCall = toolCalls.find((tc) => tc.toolName === name && callId);

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <Wrench className="h-3 w-3 text-amber-600" />
        <span className="text-xs font-mono font-medium">{name}</span>
        {matchingCall && <ToolStatusBadge status={matchingCall.status} />}
        {matchingCall?.durationMs != null && <span className="text-[11px] text-muted-foreground">{matchingCall.durationMs}ms</span>}
        <button onClick={() => setShowArgs(!showArgs)} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">
          {showArgs ? "Hide" : "Show"} args
        </button>
      </div>
      {showArgs && input && (
        <pre className="mt-1.5 text-[11px] bg-muted rounded p-2 overflow-x-auto max-h-32 overflow-y-auto font-mono">{JSON.stringify(input, null, 2)}</pre>
      )}
    </div>
  );
}

function findToolCallBlocks(message: SessionMessage, toolCalls: SessionToolCall[]): Array<{ id?: string }> {
  return toolCalls.filter((tc) => {
    const tcTime = new Date(tc.createdAt).getTime();
    const msgTime = new Date(message.createdAt).getTime();
    return Math.abs(tcTime - msgTime) < 5000;
  }).map((tc) => ({ id: String(tc.id) }));
}
