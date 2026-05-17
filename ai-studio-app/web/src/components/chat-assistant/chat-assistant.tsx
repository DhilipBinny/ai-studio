"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChatAssistantFab } from "./chat-assistant-fab";
import { ChatAssistantPanel } from "./chat-assistant-panel";
import type { ChatMessage } from "./chat-assistant-messages";
import type { PendingToolCall } from "./chat-assistant-approval";

export interface AgentOption {
  id: string;
  name: string;
  slug: string;
  description: string;
  trustLevel: string;
}

export interface ProjectOption {
  id: string;
  name: string;
}

const DEFAULT_AGENT_ID = process.env.NEXT_PUBLIC_ASSISTANT_AGENT_ID || "";
const STORAGE_KEY = "ais:chat-assistant";
const POLL_INTERVAL_MS = 2500;

interface StoredState {
  agentId: string;
  sessionId: string;
  projectId?: string;
}

export function ChatAssistant() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [autoApprove, setAutoApprove] = useState(true);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([]);
  const [approving, setApproving] = useState(false);
  const sendingRef = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageRef = useRef<string>("");

  useEffect(() => {
    async function loadData() {
      try {
        const [agentsRes, projectsRes] = await Promise.all([
          fetch("/api/agents?pageSize=50"),
          fetch("/api/projects?pageSize=50"),
        ]);

        if (agentsRes.ok) {
          const data = await agentsRes.json();
          const list: AgentOption[] = (data.data || [])
            .filter((a: { status: string }) => a.status === "active")
            .map((a: { id: string; name: string; slug: string; description: string; trustLevel: string }) => ({
              id: a.id, name: a.name, slug: a.slug || "", description: a.description || "",
              trustLevel: a.trustLevel || "supervised",
            }));
          setAgents(list);

          const stored = sessionStorage.getItem(STORAGE_KEY);
          if (stored) {
            try {
              const parsed: StoredState = JSON.parse(stored);
              if (parsed.agentId && list.find((a) => a.id === parsed.agentId)) {
                setSelectedAgentId(parsed.agentId);
                const agent = list.find((a) => a.id === parsed.agentId);
                setAutoApprove(agent?.trustLevel === "trusted");
                if (parsed.sessionId) { setSessionId(parsed.sessionId); fetchHistory(parsed.agentId, parsed.sessionId); }
                if (parsed.projectId) setSelectedProjectId(parsed.projectId);
              } else {
                setSelectedAgentId(DEFAULT_AGENT_ID || list[0]?.id || "");
              }
            } catch { setSelectedAgentId(DEFAULT_AGENT_ID || list[0]?.id || ""); }
          } else {
            const defaultId = DEFAULT_AGENT_ID || list[0]?.id || "";
            setSelectedAgentId(defaultId);
            const agent = list.find((a) => a.id === defaultId);
            setAutoApprove(agent?.trustLevel === "trusted");
          }
        }

        if (projectsRes.ok) {
          const data = await projectsRes.json();
          setProjects((data.data || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
        }
      } catch { /* auth not ready */ } finally { setLoadingAgents(false); }
    }
    loadData();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  useEffect(() => {
    if (selectedAgentId && sessionId) {
      const state: StoredState = { agentId: selectedAgentId, sessionId };
      if (selectedProjectId) state.projectId = selectedProjectId;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [selectedAgentId, sessionId, selectedProjectId]);

  async function fetchHistory(agentId: string, sid: string) {
    try {
      const res = await fetch(`/api/agents/${agentId}/sessions/${sid}/messages`);
      if (!res.ok) { setSessionId(null); sessionStorage.removeItem(STORAGE_KEY); return; }
      const data = await res.json();
      setMessages((data.messages || [])
        .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
        .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content || "" })));
    } catch { setSessionId(null); sessionStorage.removeItem(STORAGE_KEY); }
  }

  function stopPolling() {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }

  function startPolling(agentId: string, sid: string, msgCountBefore: number) {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const [msgsRes, runRes] = await Promise.all([
          fetch(`/api/agents/${agentId}/sessions/${sid}/messages`),
          fetch(`/api/runs/${sid}`),
        ]);

        const runData = runRes.ok ? await runRes.json() : null;
        const sessionStatus = runData?.status || "";

        if (sessionStatus === "waiting_approval") {
          const pending: PendingToolCall[] = (runData.toolCalls || [])
            .filter((tc: { requiresApproval: boolean; approvalStatus: string | null }) => tc.requiresApproval && !tc.approvalStatus)
            .map((tc: { id: number; toolName: string; arguments: Record<string, unknown> }) => ({
              id: String(tc.id), toolName: tc.toolName, arguments: tc.arguments,
            }));
          if (pending.length > 0) {
            if (autoApprove) {
              stopPolling();
              for (const tc of pending) {
                try { await fetch(`/api/runs/${sid}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toolCallId: tc.id, action: "approve" }) }); } catch {}
              }
              await fetch(`/api/agents/${agentId}/sessions/${sid}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: lastMessageRef.current || "continue", async: true }) }).catch(() => {});
              startPolling(agentId, sid, msgCountBefore);
            } else {
              stopPolling();
              setPendingToolCalls(pending);
              setWaitingApproval(true);
              setSending(false);
            }
            return;
          }
        }

        const isDone = ["completed", "waiting", "failed"].includes(sessionStatus);

        if (msgsRes.ok && isDone) {
          const data = await msgsRes.json();
          const allMsgs: ChatMessage[] = (data.messages || [])
            .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
            .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content || "" }));
          const lastMsg = allMsgs[allMsgs.length - 1];

          if (lastMsg?.role === "assistant" && allMsgs.length > msgCountBefore) {
            stopPolling();
            setMessages(allMsgs);
            const usage = await fetchSessionUsage(sid);
            if (usage) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], usage };
                return updated;
              });
            }
            setSending(false);
          } else if (isDone) {
            stopPolling();
            setSending(false);
          }
        }
      } catch { /* polling error, will retry */ }
    }, POLL_INTERVAL_MS);
  }

  async function fetchSessionUsage(sid: string): Promise<ChatMessage["usage"] | null> {
    try {
      const res = await fetch(`/api/runs/${sid}`);
      if (!res.ok) return null;
      const data = await res.json();
      return { inputTokens: data.totalInputTokens || 0, outputTokens: data.totalOutputTokens || 0, costUsd: parseFloat(data.totalCostUsd) || 0 };
    } catch { return null; }
  }

  const handleAgentChange = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setSessionId(null);
    setMessages([]);
    setWaitingApproval(false);
    setPendingToolCalls([]);
    stopPolling();
    sessionStorage.removeItem(STORAGE_KEY);
    const agent = agents.find((a) => a.id === agentId);
    setAutoApprove(agent?.trustLevel === "trusted");
  }, [agents]);

  const handleSend = useCallback(async (text: string) => {
    if (!selectedAgentId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    lastMessageRef.current = text;
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const url = sessionId
        ? `/api/agents/${selectedAgentId}/sessions/${sessionId}/messages`
        : `/api/agents/${selectedAgentId}/sessions`;
      const body = sessionId
        ? { message: text, async: true }
        : { message: text, channel: "studio", async: true, metadata: selectedProjectId ? { projectId: selectedProjectId } : undefined };

      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.error || res.statusText}` }]);
        setSending(false);
        return;
      }

      const data = await res.json();
      if (data.sessionId && !sessionId) setSessionId(data.sessionId);
      const sid = data.sessionId || sessionId;

      if (data.async) {
        const currentMsgCount = messages.length + 1;
        startPolling(selectedAgentId, sid, currentMsgCount);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: data.response || "(no response)", usage: data.usage }]);
        setSending(false);
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "Unknown error"}` }]);
      setSending(false);
    } finally {
      sendingRef.current = false;
    }
  }, [selectedAgentId, sessionId, selectedProjectId, messages.length]);

  const handleApprovalDecision = useCallback(async (toolCallId: string, action: "approve" | "deny") => {
    if (!sessionId) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/runs/${sessionId}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, action }),
      });
      if (res.ok) {
        setWaitingApproval(false);
        setPendingToolCalls([]);
        if (action === "approve") {
          setSending(true);
          const currentMsgCount = messages.length;
          startPolling(selectedAgentId, sessionId, currentMsgCount);
          await fetch(`/api/agents/${selectedAgentId}/sessions/${sessionId}/messages`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: lastMessageRef.current || "continue", async: true }),
          });
        } else {
          setMessages((prev) => [...prev, { role: "assistant", content: "Tool call denied. The operation was cancelled." }]);
        }
      }
    } catch { /* approval error */ } finally { setApproving(false); }
  }, [sessionId, selectedAgentId, messages.length]);

  const handleNewSession = useCallback(() => {
    setSessionId(null); setMessages([]); setWaitingApproval(false); setPendingToolCalls([]); stopPolling();
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  if (loadingAgents || agents.length === 0) return null;

  return (
    <>
      <ChatAssistantFab open={open} sending={sending} onClick={() => setOpen((o) => !o)} />
      {open && (
        <ChatAssistantPanel
          isMobile={isMobile}
          agents={agents}
          projects={projects}
          selectedAgentId={selectedAgentId}
          selectedProjectId={selectedProjectId}
          onAgentChange={handleAgentChange}
          onProjectChange={setSelectedProjectId}
          autoApprove={autoApprove}
          onAutoApproveChange={setAutoApprove}
          messages={messages}
          sending={sending}
          sessionId={sessionId}
          waitingApproval={waitingApproval}
          pendingToolCalls={pendingToolCalls}
          approving={approving}
          onApprovalDecision={handleApprovalDecision}
          onClose={() => setOpen(false)}
          onSend={handleSend}
          onNewSession={handleNewSession}
        />
      )}
    </>
  );
}
