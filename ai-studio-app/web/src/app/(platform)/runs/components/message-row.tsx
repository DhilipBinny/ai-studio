"use client";
import { useState } from "react";
import {
  User, Bot, Wrench,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import type { SessionMessage, SessionToolCall } from "@ais-app/types";
import { ToolStatusBadge } from "./session-detail";

function findToolCallBlocks(message: SessionMessage, toolCalls: SessionToolCall[]): Array<{ id?: string }> {
  return toolCalls.filter((tc) => {
    const tcTime = new Date(tc.createdAt).getTime();
    const msgTime = new Date(message.createdAt).getTime();
    return Math.abs(tcTime - msgTime) < 5000;
  }).map((tc) => ({ id: String(tc.id) }));
}

export function MessageRow({ message, toolCalls, index }: { message: SessionMessage; toolCalls: SessionToolCall[]; index: number }) {
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
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
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
