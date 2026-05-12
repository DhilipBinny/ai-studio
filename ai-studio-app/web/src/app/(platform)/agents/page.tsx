"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Bot, Pencil, Loader2, MessageSquare, Send, RotateCcw, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { Markdown } from "@/components/markdown";

interface Persona {
  identity?: string;
  instructions?: string;
  tone?: string;
  context?: string;
}

interface AgentRule {
  rule: string;
  priority?: number;
}

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  persona: Persona;
  rules: AgentRule[];
  status: string;
  version: number;
  tags: string[];
  providerModelId: string | null;
  temperature: string;
  maxTurns: number;
  maxTokensPerTurn: number;
  createdAt: string;
}

interface ProviderModel {
  id: string;
  modelId: string;
  displayName: string;
  providerName: string;
  providerType: string;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "error"> = {
  draft: "warning", active: "success", disabled: "secondary", archived: "error",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [models, setModels] = useState<ProviderModel[]>([]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/agents?${params}`);
    if (res.ok) {
      const data = await res.json();
      setAgents(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }, [page, statusFilter]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.data) setModels(d.data); })
      .catch(() => {});
  }, []);

  function getModelLabel(modelId: string | null) {
    if (!modelId) return "—";
    const m = models.find((x) => x.id === modelId);
    return m ? `${m.displayName} (${m.providerName})` : "Unknown";
  }

  return (
    <RequirePermission module="AGENTS"><>
      <PageHeader title="Agents" description="Configure and manage your AI agents.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create Agent</Button>
      </PageHeader>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-40">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {!loading && agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet" description="Create your first AI agent to get started." actionLabel="Create Agent" onAction={() => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={5} /> : agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.slug}</div>
                    {a.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{getModelLabel(a.providerModelId)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[a.status] || "secondary"}>{a.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">v{a.version}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {a.status === "active" && a.providerModelId && (
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setChatAgent(a)} title="Chat">
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditAgent(a)} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Create Agent</DialogTitle></DialogHeader>
          <CreateAgentForm models={models} onCreated={() => { setShowCreate(false); fetchAgents(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editAgent} onOpenChange={(open) => { if (!open) setEditAgent(null); }}>
        <DialogContent onClose={() => setEditAgent(null)}>
          <DialogHeader><DialogTitle>Edit Agent</DialogTitle></DialogHeader>
          {editAgent && <EditAgentForm agent={editAgent} models={models} onSaved={() => { setEditAgent(null); fetchAgents(); }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!chatAgent} onOpenChange={(open) => { if (!open) setChatAgent(null); }}>
        <DialogContent onClose={() => setChatAgent(null)} className="max-w-2xl h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle>Chat — {chatAgent?.name}</DialogTitle></DialogHeader>
          {chatAgent && <AgentChat agent={chatAgent} />}
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function ModelSelect({ value, onChange, models }: { value: string; onChange: (v: string) => void; models: ProviderModel[] }) {
  const grouped = models.reduce<Record<string, ProviderModel[]>>((acc, m) => {
    const key = m.providerName || m.providerType;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No model selected</option>
      {Object.entries(grouped).map(([provider, providerModels]) => (
        <optgroup key={provider} label={provider}>
          {providerModels.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function PersonaEditor({ persona, onChange }: { persona: Persona; onChange: (p: Persona) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Identity / Role</Label>
        <Textarea value={persona.identity || ""} onChange={(e) => onChange({ ...persona, identity: e.target.value })} rows={2} placeholder="You are a document review specialist for compliance auditing." />
        <p className="text-[11px] text-muted-foreground">Who is this agent? What is its role?</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Instructions</Label>
        <Textarea value={persona.instructions || ""} onChange={(e) => onChange({ ...persona, instructions: e.target.value })} rows={3} placeholder="1. Read the full document before responding&#10;2. Check against ISO 27001 standards&#10;3. Always cite page numbers" />
        <p className="text-[11px] text-muted-foreground">Step-by-step instructions for this agent.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Tone & Style</Label>
        <Textarea value={persona.tone || ""} onChange={(e) => onChange({ ...persona, tone: e.target.value })} rows={2} placeholder="Professional and thorough. Use bullet points. Flag critical issues in bold." />
        <p className="text-[11px] text-muted-foreground">How should the agent communicate?</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Context</Label>
        <Textarea value={persona.context || ""} onChange={(e) => onChange({ ...persona, context: e.target.value })} rows={2} placeholder="Domain knowledge, background info the agent should know." />
      </div>
    </div>
  );
}

function RulesEditor({ rules, onChange }: { rules: AgentRule[]; onChange: (r: AgentRule[]) => void }) {
  const [newRule, setNewRule] = useState("");

  function addRule() {
    const text = newRule.trim();
    if (!text) return;
    onChange([...rules, { rule: text, priority: rules.length + 1 }]);
    setNewRule("");
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Rules / Constraints</Label>
      {rules.length > 0 && (
        <div className="space-y-1">
          {rules.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground mt-0.5 shrink-0">-</span>
              <span className="flex-1">{r.rule}</span>
              <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive mt-0.5 shrink-0">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={newRule} onChange={(e) => setNewRule(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule(); } }} placeholder="Add a rule..." className="text-sm" />
        <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={!newRule.trim()}>Add</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Hard constraints the agent must follow.</p>
    </div>
  );
}

function CreateAgentForm({ models, onCreated }: { models: ProviderModel[]; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", slug: "", description: "",
    providerModelId: "", temperature: "0.7", maxTurns: "25", maxTokensPerTurn: "4096",
  });
  const [persona, setPersona] = useState<Persona>({});
  const [rules, setRules] = useState<AgentRule[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rawPrompt, setRawPrompt] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const body: Record<string, unknown> = {
      name: form.name,
      slug,
      description: form.description,
      persona,
      rules,
      temperature: parseFloat(form.temperature) || 0.7,
      maxTurns: parseInt(form.maxTurns) || 25,
      maxTokensPerTurn: parseInt(form.maxTokensPerTurn) || 4096,
    };
    if (showAdvanced && rawPrompt.trim()) body.systemPrompt = rawPrompt;
    if (form.providerModelId) body.providerModelId = form.providerModelId;
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) onCreated();
    else { const data = await res.json(); setError(data.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Document Reviewer" />
      </div>
      <div className="space-y-2">
        <Label>Slug</Label>
        <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="Auto-generated from name" />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="Brief description of this agent." />
      </div>
      <div className="space-y-2">
        <Label>Model</Label>
        <ModelSelect value={form.providerModelId} onChange={(v) => setForm((f) => ({ ...f, providerModelId: v }))} models={models} />
        {models.length === 0 && <p className="text-xs text-amber-600">No models available. Test a provider connection first.</p>}
      </div>

      <div className="border rounded-lg p-3 space-y-1">
        <p className="text-sm font-medium">Persona</p>
        <PersonaEditor persona={persona} onChange={setPersona} />
      </div>

      <RulesEditor rules={rules} onChange={setRules} />

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Temperature</Label>
          <Input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max Turns</Label>
          <Input type="number" min="1" max="100" value={form.maxTurns} onChange={(e) => setForm((f) => ({ ...f, maxTurns: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max Tokens</Label>
          <Input type="number" min="256" max="128000" value={form.maxTokensPerTurn} onChange={(e) => setForm((f) => ({ ...f, maxTokensPerTurn: e.target.value }))} />
        </div>
      </div>

      <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Advanced: Raw system prompt override
      </button>
      {showAdvanced && (
        <Textarea value={rawPrompt} onChange={(e) => setRawPrompt(e.target.value)} rows={4} placeholder="Override the assembled prompt with raw text. Leave empty to use persona sections." className="font-mono text-xs" />
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create Agent"}
      </Button>
    </form>
  );
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tokens?: { input: number; output: number };
}

function AgentChat({ agent }: { agent: Agent }) {
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
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleNewSession}>
            <RotateCcw className="h-3 w-3 mr-1" /> New Session
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 min-h-0 rounded-lg border bg-muted/30 p-4">
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
            <div className="bg-background border rounded-lg px-3 py-2 text-sm text-muted-foreground">
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

function EditAgentForm({ agent, models, onSaved }: { agent: Agent; models: ProviderModel[]; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: agent.name,
    description: agent.description || "",
    providerModelId: agent.providerModelId || "",
    temperature: agent.temperature || "0.7",
    maxTurns: String(agent.maxTurns || 25),
    maxTokensPerTurn: String(agent.maxTokensPerTurn || 4096),
    status: agent.status,
  });
  const [persona, setPersona] = useState<Persona>(agent.persona || {});
  const [rules, setRules] = useState<AgentRule[]>(agent.rules || []);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rawPrompt, setRawPrompt] = useState(agent.systemPrompt || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const body: Record<string, unknown> = {};
    if (form.name !== agent.name) body.name = form.name;
    if (form.description !== (agent.description || "")) body.description = form.description;
    if (form.providerModelId !== (agent.providerModelId || "")) body.providerModelId = form.providerModelId || null;
    if (form.status !== agent.status) body.status = form.status;

    if (JSON.stringify(persona) !== JSON.stringify(agent.persona || {})) body.persona = persona;
    if (JSON.stringify(rules) !== JSON.stringify(agent.rules || [])) body.rules = rules;
    if (rawPrompt !== (agent.systemPrompt || "")) body.systemPrompt = rawPrompt;

    const temp = parseFloat(form.temperature);
    if (!isNaN(temp) && String(temp) !== agent.temperature) body.temperature = temp;
    const turns = parseInt(form.maxTurns);
    if (!isNaN(turns) && turns !== agent.maxTurns) body.maxTurns = turns;
    const tokens = parseInt(form.maxTokensPerTurn);
    if (!isNaN(tokens) && tokens !== agent.maxTokensPerTurn) body.maxTokensPerTurn = tokens;

    if (Object.keys(body).length === 0) {
      setError("No changes to save.");
      setSubmitting(false);
      return;
    }

    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) onSaved();
    else { const d = await res.json(); setError(d.error || "Failed to update"); }
    setSubmitting(false);
  }

  async function handleDeactivate() {
    setDeactivating(true);
    const res = await fetch(`/api/agents/${agent.id}/deactivate`, { method: "POST" });
    if (res.ok) onSaved();
    else { const d = await res.json(); setError(d.error || "Failed to deactivate"); }
    setDeactivating(false);
    setConfirmDeactivate(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="space-y-1">
        <p className="text-sm font-mono text-muted-foreground">{agent.slug}</p>
        <p className="text-xs text-muted-foreground">Version: v{agent.version}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Name <span className="text-destructive">*</span></Label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
      </div>

      <div className="space-y-2">
        <Label>Model</Label>
        <ModelSelect value={form.providerModelId} onChange={(v) => setForm((f) => ({ ...f, providerModelId: v }))} models={models} />
      </div>

      <div className="border rounded-lg p-3 space-y-1">
        <p className="text-sm font-medium">Persona</p>
        <PersonaEditor persona={persona} onChange={setPersona} />
      </div>

      <RulesEditor rules={rules} onChange={setRules} />

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Temperature</Label>
          <Input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max Turns</Label>
          <Input type="number" min="1" max="100" value={form.maxTurns} onChange={(e) => setForm((f) => ({ ...f, maxTurns: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max Tokens</Label>
          <Input type="number" min="256" max="128000" value={form.maxTokensPerTurn} onChange={(e) => setForm((f) => ({ ...f, maxTokensPerTurn: e.target.value }))} />
        </div>
      </div>

      <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Advanced: Raw system prompt override
      </button>
      {showAdvanced && (
        <Textarea value={rawPrompt} onChange={(e) => setRawPrompt(e.target.value)} rows={4} placeholder="Override the assembled prompt with raw text." className="font-mono text-xs" />
      )}

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
        </Button>
        {!confirmDeactivate ? (
          <Button type="button" variant="outline" onClick={() => setConfirmDeactivate(true)}>
            Delete
          </Button>
        ) : (
          <Button type="button" variant="destructive" onClick={handleDeactivate} disabled={deactivating}>
            {deactivating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Delete"}
          </Button>
        )}
      </div>
    </form>
  );
}
