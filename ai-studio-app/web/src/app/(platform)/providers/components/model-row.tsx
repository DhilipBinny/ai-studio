"use client";

import { useState } from "react";
import { Loader2, Send, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { type ProviderModel } from "./types";

export function ModelRow({ model, providerId, providerType, isDefault, onSetDefault }: {
  model: ProviderModel;
  providerId: string;
  providerType: string;
  isDefault: boolean;
  onSetDefault: () => void;
}) {
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [chatting, setChatting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatMeta, setChatMeta] = useState<{ latencyMs: number; inputTokens: number; outputTokens: number } | null>(null);

  async function handleChat() {
    if (!chatInput.trim()) return;
    setChatting(true);
    setChatResponse(null);
    setChatError(null);
    setChatMeta(null);

    try {
      const res = await fetch(`/api/providers/${providerId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ modelId: model.modelId, message: chatInput }),
      });
      const result = await res.json();
      if (result.success) {
        setChatResponse(result.response);
        setChatMeta({ latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      } else {
        setChatError(result.error || "Chat failed");
      }
    } catch {
      setChatError("Request failed");
    }
    setChatting(false);
  }

  return (
    <div className="rounded-md bg-muted/50 px-3 py-1.5 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{model.displayName}</span>
          <span className="font-mono text-muted-foreground">{model.modelId}</span>
          {(model.capabilities as string[])?.includes("embedding") && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0">embedding</Badge>
          )}
          {(model.capabilities as string[])?.includes("reranking") && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0">reranking</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {model.contextWindow && <span>{(model.contextWindow / 1000).toFixed(0)}K ctx</span>}
          {model.maxOutputTokens && <span>{(model.maxOutputTokens / 1000).toFixed(0)}K out</span>}
          {(model.capabilities as string[])?.includes("chat") && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowChat(!showChat)} className="h-6 px-2 text-[10px]">
                <Send className="h-3 w-3" /> Try
              </Button>
              <button onClick={onSetDefault} className="p-0.5 transition-colors" title={isDefault ? "Default model" : "Set as default"}>
                <Star className={`h-3.5 w-3.5 ${isDefault ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"}`} />
              </button>
            </>
          )}
        </div>
      </div>

      {showChat && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleChat(); }}
              placeholder="Type a message..."
              className="h-8 text-xs flex-1"
              disabled={chatting}
              autoFocus
            />
            <Button variant="outline" size="sm" onClick={handleChat} disabled={chatting || !chatInput.trim()} className="h-8 px-3">
              {chatting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
            </Button>
          </div>

          {chatResponse && (
            <div className="rounded-md bg-background border border-border p-2 text-xs">
              <p>{chatResponse}</p>
              {chatMeta && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {chatMeta.latencyMs}ms · {chatMeta.inputTokens} in · {chatMeta.outputTokens} out
                </p>
              )}
            </div>
          )}

          {chatError && <p className="text-xs text-destructive">{chatError}</p>}
        </div>
      )}
    </div>
  );
}
