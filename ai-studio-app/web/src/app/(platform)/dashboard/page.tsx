"use client";
import { RequirePermission } from "@/components/require-permission";

import { useState, useEffect } from "react";
import {
  Bot, Wrench, MessageSquare, AlertTriangle,
  Database, Plug, DollarSign,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";

interface TopAgent {
  agentId: string;
  agentName: string;
  sessions: number;
  tokens: string | number;
  toolCalls: string | number;
  costUsd: number;
}

interface RecentSession {
  id: string;
  agentName: string;
  status: string;
  channel: string;
  totalTurns: number;
  totalToolCalls: number;
  tokens: number;
  costUsd: number;
  createdAt: string;
}

interface Stats {
  agents: number;
  tools: number;
  knowledgeBases: number;
  connectors: number;
  workflows: number;
  totalSessions: number;
  sessionsToday: number;
  failedToday: number;
  costToday: number;
  totalCostUsd: number;
  avgCostPerSession: number;
  topAgents: TopAgent[];
  recentSessions: RecentSession[];
}

const STATUS_VARIANT: Record<string, "info" | "success" | "error" | "warning" | "secondary"> = {
  pending: "secondary", running: "info", waiting: "info", completed: "success", failed: "error", cancelled: "warning", timeout: "error",
};

const CHANNEL_LABEL: Record<string, string> = {
  studio: "Studio", api: "API", embedded: "Embedded", workflow: "Workflow",
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats").then((r) => r.ok ? r.json() : null).then(setStats);
  }, []);

  return (
    <RequirePermission module="DASHBOARD"><>
      <PageHeader title="Dashboard" description="Platform overview and agent performance." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={MessageSquare} label="Sessions Today" value={stats?.sessionsToday} />
        <StatCard icon={AlertTriangle} label="Failed Today" value={stats?.failedToday} variant={stats && stats.failedToday > 0 ? "error" : "default"} />
        <StatCard icon={DollarSign} label="Cost Today" value={stats ? formatCost(stats.costToday) : undefined} />
        <StatCard icon={MessageSquare} label="Total Sessions" value={stats?.totalSessions} />
        <StatCard icon={DollarSign} label="Total Cost" value={stats ? formatCost(stats.totalCostUsd) : undefined} />
        <StatCard icon={DollarSign} label="Avg / Session" value={stats ? formatCost(stats.avgCostPerSession) : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Agents" value={stats?.agents} icon={Bot} />
        <MiniStat label="Tools" value={stats?.tools} icon={Wrench} />
        <MiniStat label="Knowledge Bases" value={stats?.knowledgeBases} icon={Database} />
        <MiniStat label="Connectors" value={stats?.connectors} icon={Plug} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Agents</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {!stats ? (
              <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : stats.topAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No agent sessions yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Tool Calls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.topAgents.map((a) => (
                    <TableRow key={a.agentId}>
                      <TableCell className="font-medium">{a.agentName}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{Number(a.sessions)}</TableCell>
                      <TableCell className="text-right text-muted-foreground font-mono text-xs">{formatNumber(Number(a.tokens || 0))}</TableCell>
                      <TableCell className="text-right text-muted-foreground font-mono text-xs">{formatCost(a.costUsd)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{Number(a.toolCalls || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {!stats ? (
              <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : stats.recentSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No sessions yet. Chat with an agent to get started.</p>
            ) : (
              <div className="space-y-1.5">
                {stats.recentSessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{s.agentName}</span>
                        <Badge variant={STATUS_VARIANT[s.status] || "secondary"} className="text-[9px] shrink-0">{s.status}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                        <span>{CHANNEL_LABEL[s.channel] || s.channel}</span>
                        <span>{s.totalTurns} turn{s.totalTurns !== 1 ? "s" : ""}</span>
                        {s.totalToolCalls > 0 && <span>{s.totalToolCalls} tool{s.totalToolCalls !== 1 ? "s" : ""}</span>}
                        <span>{formatNumber(s.tokens)} tokens</span>
                        {s.costUsd > 0 && <span className="font-mono">{formatCost(s.costUsd)}</span>}
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatTime(s.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </></RequirePermission>
  );
}

function StatCard({ icon: Icon, label, value, variant }: { icon: React.ComponentType<{ className?: string }>; label: string; value?: string | number; variant?: "success" | "error" | "default" }) {
  const colorClass = variant === "success" ? "text-green-600" : variant === "error" ? "text-red-600" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        {value !== undefined ? (
          <p className={`text-2xl font-semibold tracking-tight ${colorClass}`}>{value}</p>
        ) : (
          <Skeleton className="mt-1 h-8 w-16" />
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, icon: Icon }: { label: string; value?: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {value !== undefined ? (
          <p className="text-sm font-semibold">{value}</p>
        ) : (
          <Skeleton className="h-4 w-8" />
        )}
      </div>
    </div>
  );
}
