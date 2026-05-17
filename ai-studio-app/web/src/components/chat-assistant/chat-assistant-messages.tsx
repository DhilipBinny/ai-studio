"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import { Loader2, Copy, Check } from "lucide-react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }, [text]);

  return (
    <button onClick={handleCopy} className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted" aria-label="Copy message">
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

interface ChatAssistantMessagesProps {
  messages: ChatMessage[];
  sending: boolean;
}

export function ChatAssistantMessages({ messages, sending }: ChatAssistantMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  if (messages.length === 0 && !sending) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <p>Send a message to start a conversation.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3" role="log" aria-live="polite">
      {messages.map((msg, i) => (
        <div key={`${i}-${msg.role}`} className={cn("group flex gap-1", msg.role === "user" ? "justify-end" : "justify-start")}>
          {msg.role === "assistant" && (
            <div className="flex flex-col items-start max-w-[88%]">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                <Markdown content={msg.content} className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <CopyMessageButton text={msg.content} />
                {msg.usage && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatTokens((msg.usage.inputTokens || 0) + (msg.usage.outputTokens || 0))} tokens · ${(msg.usage.costUsd ?? 0).toFixed(4)}
                  </span>
                )}
              </div>
            </div>
          )}
          {msg.role === "user" && (
            <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          )}
        </div>
      ))}
      {sending && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Thinking...</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
