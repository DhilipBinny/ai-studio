"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Send, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import type { Agent } from "@ais-app/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tokens?: { input: number; output: number };
}

export function AgentChat({ agent }: { agent: Agent }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState({ input: 0, output: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => { scrollToBottom(); }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      let res: Response;
      if (sessionId) {
        res = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
      } else {
        res = await fetch(`/api/agents/${agent.id}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
      }

      const data = await res.json();
      if (res.ok) {
        if (!sessionId) setSessionId(data.sessionId);
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: data.response,
          tokens: { input: data.usage.inputTokens, output: data.usage.outputTokens },
        }]);
        setTotalTokens((prev) => ({
          input: prev.input + data.usage.inputTokens,
          output: prev.output + data.usage.outputTokens,
        }));
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${data.error || "Failed to get response"}` }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error: Network error" }]);
    }
    setSending(false);
  }

  function handleNewSession() {
    setMessages([]);
    setSessionId(null);
    setTotalTokens({ input: 0, output: 0 });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-muted-foreground">
          {sessionId ? (
            <span>Session: {sessionId.slice(0, 8)}... &middot; Tokens: {totalTokens.input}↑ {totalTokens.output}↓</span>
          ) : (
            <span>New session</span>
          )}
        </div>
        {sessionId && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleNewSession} aria-label="New session">
            <RotateCcw className="h-3 w-3 mr-1" /> New Session
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 min-h-0 rounded-lg border border-border bg-muted/30 p-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Send a message to start chatting with {agent.name}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-background border"
            }`}>
              {m.role === "assistant" ? (
                <Markdown content={m.content} />
              ) : (
                <div className="whitespace-pre-wrap">{m.content}</div>
              )}
              {m.tokens && (
                <div className="text-[10px] mt-1 opacity-60">
                  {m.tokens.input}↑ {m.tokens.output}↓
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex gap-2 mt-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Type a message..."
          disabled={sending}
          className="flex-1"
        />
        <Button onClick={handleSend} disabled={sending || !input.trim()} size="sm" className="px-3">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
