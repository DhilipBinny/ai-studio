"use client";

import { useEffect } from "react";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatAssistantMessages, type ChatMessage } from "./chat-assistant-messages";
import { ChatAssistantInput } from "./chat-assistant-input";
import { ChatAssistantActivity } from "./chat-assistant-activity";
import { ChatAssistantApproval, type PendingToolCall } from "./chat-assistant-approval";
import type { AgentOption, ProjectOption } from "./chat-assistant";

interface ChatAssistantPanelProps {
  isMobile: boolean;
  agents: AgentOption[];
  projects: ProjectOption[];
  selectedAgentId: string;
  selectedProjectId: string;
  onAgentChange: (agentId: string) => void;
  onProjectChange: (projectId: string) => void;
  autoApprove: boolean;
  onAutoApproveChange: (value: boolean) => void;
  messages: ChatMessage[];
  sending: boolean;
  sessionId: string | null;
  waitingApproval: boolean;
  pendingToolCalls: PendingToolCall[];
  approving: boolean;
  onApprovalDecision: (toolCallId: string, action: "approve" | "deny") => void;
  onClose: () => void;
  onSend: (message: string) => void;
  onNewSession: () => void;
  streamingText?: string;
}

export function ChatAssistantPanel({
  isMobile, agents, projects, selectedAgentId, selectedProjectId,
  onAgentChange, onProjectChange, autoApprove, onAutoApproveChange,
  messages, sending, sessionId, waitingApproval, pendingToolCalls, approving,
  onApprovalDecision, onClose, onSend, onNewSession, streamingText,
}: ChatAssistantPanelProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Chat assistant"
      className={cn(
        "flex flex-col overflow-hidden border bg-background shadow-2xl",
        "animate-in slide-in-from-bottom-2 fade-in duration-200",
        isMobile ? "fixed inset-0 z-60" : "fixed bottom-24 right-6 z-60 h-[560px] w-[400px] rounded-xl"
      )}
    >
      {/* Header */}
      <div className="border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <select
            value={selectedAgentId}
            onChange={(e) => onAgentChange(e.target.value)}
            disabled={sending}
            aria-label="Select agent"
            className="flex-1 min-w-0 truncate rounded-md border bg-background px-2 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="flex items-center gap-1 ml-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNewSession} aria-label="New session" disabled={sending}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close chat">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {projects.length > 0 && (
            <select
              value={selectedProjectId}
              onChange={(e) => onProjectChange(e.target.value)}
              disabled={sending || !!sessionId}
              aria-label="Select project"
              title={sessionId ? "Project cannot be changed after session starts" : undefined}
              className="flex-1 min-w-0 truncate rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => onAutoApproveChange(e.target.checked)}
              className="h-3 w-3 rounded"
            />
            Auto-approve
          </label>
        </div>
      </div>

      {/* Messages */}
      <ChatAssistantMessages messages={messages} sending={sending} streamingText={streamingText} />

      {/* Approval card */}
      {waitingApproval && !autoApprove && (
        <ChatAssistantApproval pendingCalls={pendingToolCalls} onDecision={onApprovalDecision} disabled={approving} />
      )}

      {/* Activity indicator */}
      <ChatAssistantActivity sessionId={sessionId} sending={sending} />

      {/* Input */}
      <ChatAssistantInput sending={sending || waitingApproval} onSend={onSend} />
    </div>
  );
}
