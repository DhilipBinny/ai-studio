"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, X, ChevronDown, ChevronRight, BookOpen, Trash2, Plug, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Agent, Persona, AgentRule, ProviderModel } from "@ais-app/types";

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

interface AssignedKB {
  id: string;
  knowledgeBaseId: string;
  kbName: string;
  kbDescription: string;
  documentCount: number;
  chunkCount: number;
}

interface AvailableKB {
  id: string;
  name: string;
  documentCount: number;
  chunkCount: number;
}

function KBAssignment({ agentId }: { agentId: string }) {
  const [assigned, setAssigned] = useState<AssignedKB[]>([]);
  const [available, setAvailable] = useState<AvailableKB[]>([]);
  const [selectedKB, setSelectedKB] = useState("");
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const fetchAssigned = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/knowledge-bases`);
    if (res.ok) { const d = await res.json(); setAssigned(d.data); }
  }, [agentId]);

  const fetchAvailable = useCallback(async () => {
    const res = await fetch("/api/knowledge-bases?pageSize=100");
    if (res.ok) { const d = await res.json(); setAvailable(d.data); }
  }, []);

  useEffect(() => { Promise.all([fetchAssigned(), fetchAvailable()]).then(() => setLoading(false)); }, [fetchAssigned, fetchAvailable]);

  const unassigned = available.filter((kb) => !assigned.some((a) => a.knowledgeBaseId === kb.id));

  async function handleAssign() {
    if (!selectedKB) return;
    setAssigning(true);
    const res = await fetch(`/api/agents/${agentId}/knowledge-bases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ knowledgeBaseId: selectedKB }),
    });
    if (res.ok) { setSelectedKB(""); await fetchAssigned(); }
    setAssigning(false);
  }

  async function handleRemove(assignmentId: string) {
    await fetch(`/api/agents/${agentId}/knowledge-bases/${assignmentId}`, { method: "DELETE" });
    await fetchAssigned();
  }

  if (loading) return <div className="text-xs text-muted-foreground">Loading KBs...</div>;

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Knowledge Bases</p>
      </div>

      {assigned.length > 0 ? (
        <div className="space-y-1">
          {assigned.map((kb) => (
            <div key={kb.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
              <div>
                <span className="text-sm">{kb.kbName}</span>
                <span className="text-xs text-muted-foreground ml-2">{kb.documentCount} docs &middot; {kb.chunkCount.toLocaleString()} chunks</span>
              </div>
              <button type="button" onClick={() => handleRemove(kb.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No knowledge bases assigned. The agent will not have access to document search.</p>
      )}

      {unassigned.length > 0 && (
        <div className="flex gap-2">
          <Select value={selectedKB} onChange={(e) => setSelectedKB(e.target.value)} className="flex-1 text-sm">
            <option value="">Select a knowledge base...</option>
            {unassigned.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name} ({kb.documentCount} docs)</option>
            ))}
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={handleAssign} disabled={!selectedKB || assigning}>
            {assigning ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">Assigned KBs give the agent a knowledge_search tool to query uploaded documents.</p>
    </div>
  );
}

interface AssignedConnector {
  id: string;
  connectorId: string;
  connectorName: string;
  connectorType: string;
  status: string;
}

function ConnectorAssignment({ agentId }: { agentId: string }) {
  const [assigned, setAssigned] = useState<AssignedConnector[]>([]);
  const [available, setAvailable] = useState<Array<{ id: string; name: string; connectorType: string; status: string }>>([]);
  const [selectedConnector, setSelectedConnector] = useState("");
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const fetchAssigned = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/connectors`);
    if (res.ok) { const d = await res.json(); setAssigned(d.data); }
  }, [agentId]);

  const fetchAvailable = useCallback(async () => {
    const res = await fetch("/api/connectors?pageSize=100");
    if (res.ok) { const d = await res.json(); setAvailable(d.data.filter((c: Record<string, unknown>) => c.connectorType === "mcp")); }
  }, []);

  useEffect(() => { Promise.all([fetchAssigned(), fetchAvailable()]).then(() => setLoading(false)); }, [fetchAssigned, fetchAvailable]);

  const unassigned = available.filter((c) => !assigned.some((a) => a.connectorId === c.id));

  async function handleAssign() {
    if (!selectedConnector) return;
    setAssigning(true);
    const res = await fetch(`/api/agents/${agentId}/connectors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorId: selectedConnector }),
    });
    if (res.ok) { setSelectedConnector(""); await fetchAssigned(); }
    setAssigning(false);
  }

  async function handleRemove(assignmentId: string) {
    await fetch(`/api/agents/${agentId}/connectors/${assignmentId}`, { method: "DELETE" });
    await fetchAssigned();
  }

  if (loading) return <div className="text-xs text-muted-foreground">Loading connectors...</div>;

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">MCP Connectors</p>
      </div>

      {assigned.length > 0 ? (
        <div className="space-y-1">
          {assigned.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
              <div>
                <span className="text-sm">{c.connectorName}</span>
                <Badge variant={c.status === "active" ? "success" : "secondary"} className="ml-2 text-[9px]">{c.status}</Badge>
              </div>
              <button type="button" onClick={() => handleRemove(c.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No MCP connectors assigned. Add connectors to give the agent access to external tools.</p>
      )}

      {unassigned.length > 0 && (
        <div className="flex gap-2">
          <Select value={selectedConnector} onChange={(e) => setSelectedConnector(e.target.value)} className="flex-1 text-sm">
            <option value="">Select a connector...</option>
            {unassigned.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.connectorType})</option>
            ))}
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={handleAssign} disabled={!selectedConnector || assigning}>
            {assigning ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">Assigned MCP connectors give the agent access to external tools (GitHub, Slack, etc.).</p>
    </div>
  );
}

function ToolRiskBadge({ level }: { level: string }) {
  const config: Record<string, { label: string; className: string }> = {
    safe: { label: "Safe", className: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300" },
    moderate: { label: "Moderate", className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300" },
    dangerous: { label: "Dangerous", className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300" },
  };
  const c = config[level] || { label: level, className: "" };
  return <Badge variant="outline" className={`text-[9px] ${c.className}`}>{c.label}</Badge>;
}

function ToolAssignment({ agentId }: { agentId: string }) {
  const [assigned, setAssigned] = useState<Array<{ id: string; toolId: string; toolName: string; toolDisplayName: string; riskLevel: string }>>([]);
  const [available, setAvailable] = useState<Array<{ id: string; name: string; displayName: string; riskLevel: string; category: string }>>([]);
  const [selectedTool, setSelectedTool] = useState("");
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const fetchAssigned = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/tools`);
    if (res.ok) { const d = await res.json(); setAssigned(d.data || []); }
  }, [agentId]);

  const fetchAvailable = useCallback(async () => {
    const res = await fetch("/api/tools?pageSize=100&type=builtin");
    if (res.ok) {
      const d = await res.json();
      setAvailable((d.data || []).filter((t: Record<string, unknown>) => t.riskLevel !== "safe"));
    }
  }, []);

  useEffect(() => { Promise.all([fetchAssigned(), fetchAvailable()]).then(() => setLoading(false)); }, [fetchAssigned, fetchAvailable]);

  const unassigned = available.filter((t) => !assigned.some((a) => a.toolId === t.id));

  async function handleAssign() {
    if (!selectedTool) return;
    setAssigning(true);
    const res = await fetch(`/api/agents/${agentId}/tools`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolId: selectedTool }),
    });
    if (res.ok) { setSelectedTool(""); await fetchAssigned(); }
    setAssigning(false);
  }

  async function handleRemove(assignmentId: string) {
    await fetch(`/api/agents/${agentId}/tools/${assignmentId}`, { method: "DELETE" });
    await fetchAssigned();
  }

  if (loading) return <div className="text-xs text-muted-foreground">Loading tools...</div>;

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Built-in Tools</p>
      </div>

      {assigned.length > 0 ? (
        <div className="space-y-1">
          {assigned.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm">{t.toolDisplayName}</span>
                <ToolRiskBadge level={t.riskLevel} />
              </div>
              <button type="button" onClick={() => handleRemove(t.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No extra tools assigned. Safe tools (read_file, grep, web_fetch, etc.) are auto-available.</p>
      )}

      {unassigned.length > 0 && (
        <div className="flex gap-2">
          <Select value={selectedTool} onChange={(e) => setSelectedTool(e.target.value)} className="flex-1 text-sm">
            <option value="">Select a tool...</option>
            {unassigned.map((t) => (
              <option key={t.id} value={t.id}>{t.displayName} ({t.riskLevel})</option>
            ))}
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={handleAssign} disabled={!selectedTool || assigning}>
            {assigning ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">Safe tools are auto-available. Assign moderate/dangerous tools explicitly.</p>
    </div>
  );
}

export function CreateAgentForm({ models, onCreated }: { models: ProviderModel[]; onCreated: () => void }) {
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

      <div className="border border-border rounded-lg p-3 space-y-1">
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

export function EditAgentForm({ agent, models, onSaved }: { agent: Agent; models: ProviderModel[]; onSaved: () => void }) {
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

      <div className="border border-border rounded-lg p-3 space-y-1">
        <p className="text-sm font-medium">Persona</p>
        <PersonaEditor persona={persona} onChange={setPersona} />
      </div>

      <RulesEditor rules={rules} onChange={setRules} />

      <KBAssignment agentId={agent.id} />

      <ConnectorAssignment agentId={agent.id} />

      <ToolAssignment agentId={agent.id} />

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
