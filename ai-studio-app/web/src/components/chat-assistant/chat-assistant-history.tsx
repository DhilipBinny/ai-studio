"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SessionSummary {
  id: string;
  status: string;
  totalTurns: number;
  totalCostUsd: string;
  createdAt: string;
  completedAt: string | null;
}

interface ChatAssistantHistoryProps {
  agentId: string;
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onBack: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "bg-green-100 text-green-700";
    case "waiting": return "bg-blue-100 text-blue-700";
    case "running": case "pending": return "bg-amber-100 text-amber-700";
    case "failed": return "bg-red-100 text-red-700";
    default: return "bg-muted text-muted-foreground";
  }
}

export function ChatAssistantHistory({ agentId, currentSessionId, onSelectSession, onBack }: ChatAssistantHistoryProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/runs?agentId=${agentId}&pageSize=20`);
        if (res.ok) {
          const data = await res.json();
          setSessions(
            (data.data || []).filter((s: { channel: string }) => s.channel === "studio")
          );
        }
      } catch { /* ignore */ } finally { setLoading(false); }
    }
    load();
  }, [agentId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack} aria-label="Back to chat">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-sm font-medium">Session History</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-2 opacity-40" />
            <p>No past sessions</p>
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <div className="divide-y">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={cn(
                  "w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                  s.id === currentSessionId && "bg-muted"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium", statusColor(s.status))}>
                    {s.status}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(s.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{s.totalTurns} turn{s.totalTurns !== 1 ? "s" : ""}</span>
                  {parseFloat(s.totalCostUsd) > 0 && (
                    <span>${parseFloat(s.totalCostUsd).toFixed(4)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
