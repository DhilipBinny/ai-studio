"use client";
import { RequirePermission } from "@/components/require-permission";

import { useState, useEffect, useCallback } from "react";
import { Plus, TestTube, Check, Loader2, ExternalLink, Trash2, Key, Globe, ChevronDown, ChevronRight, Star, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

interface ProviderModel {
  id: string;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

interface Provider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyRef: string | null;
  config: Record<string, unknown>;
  status: string;
  modelCount: number;
  models: ProviderModel[];
}

const PROVIDER_TYPES = [
  { id: "anthropic", name: "Anthropic", description: "Claude Sonnet, Opus, Haiku" },
  { id: "openai", name: "OpenAI", description: "GPT-4o, o1, o3, o4-mini" },
  { id: "ollama", name: "Ollama", description: "Local models via Ollama" },
  { id: "openai_compatible", name: "OpenAI Compatible", description: "LM Studio, Together, Groq, vLLM" },
];

const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "secondary"> = {
  active: "success",
  inactive: "warning",
  error: "error",
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/providers?page=1&pageSize=${DEFAULT_PAGE_SIZE}`);
    if (res.ok) {
      const d = await res.json();
      setProviders(d.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.ok ? r.json() : null).then((d) => {
      const entries = d?.data || d || [];
      const dm = Array.isArray(entries) ? entries.find((e: Record<string, unknown>) => e.key === "default_model") : null;
      if (dm?.value?.providerModelId) setDefaultModelId(dm.value.providerModelId);
    }).catch(() => {});
  }, []);

  const hasAvailableTypes = PROVIDER_TYPES.length > 0;

  return (
    <RequirePermission module="PROVIDERS"><>
      <PageHeader title="Providers" description="Manage LLM providers and model configurations.">
        {hasAvailableTypes && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> Add Provider
          </Button>
        )}
      </PageHeader>

      {!loading && providers.length === 0 ? (
        <EmptyState
          icon={ExternalLink}
          title="No providers configured"
          description="Connect an LLM provider to start using AI models."
          actionLabel="Add Provider"
          onAction={() => setShowAdd(true)}
        />
      ) : loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} onUpdated={fetchProviders} defaultModelId={defaultModelId} onSetDefault={setDefaultModelId} />
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent onClose={() => setShowAdd(false)} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Provider</DialogTitle>
          </DialogHeader>
          <div className="flex-1">
            <AddProviderForm
              onCreated={() => { setShowAdd(false); fetchProviders(); }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function ProviderCard({ provider, onUpdated, defaultModelId, onSetDefault }: { provider: Provider; onUpdated: () => void; defaultModelId: string | null; onSetDefault: (id: string) => void }) {
  const typeInfo = PROVIDER_TYPES.find((t) => t.id === provider.providerType);
  const authMethod = (provider.config as Record<string, unknown>)?.authMethod as string | undefined;
  const isOAuth = authMethod === "oauth_token";

  const [showConfig, setShowConfig] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [editName, setEditName] = useState(provider.name);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl || "");
  const [betaFlags, setBetaFlags] = useState(
    (provider.config as Record<string, unknown>)?.betaFlags as string || (isOAuth ? ANTHROPIC_OAUTH_DEFAULTS.betaFlags : "")
  );
  const [systemPromptPrefix, setSystemPromptPrefix] = useState(
    (provider.config as Record<string, unknown>)?.systemPromptPrefix as string || (isOAuth ? ANTHROPIC_OAUTH_DEFAULTS.systemPromptPrefix : "")
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = {};
    if (editName !== provider.name) body.name = editName;
    if (baseUrl) body.baseUrl = baseUrl;
    if (apiKey) body.apiKeyRef = apiKey;
    if (authMethod === "oauth_token" && (betaFlags || systemPromptPrefix)) {
      body.config = {
        ...provider.config as Record<string, unknown>,
        betaFlags,
        systemPromptPrefix,
      };
    }
    const res = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setMessage({ text: "Saved", ok: true });
      setApiKey("");
      setShowConfig(false);
      onUpdated();
    } else {
      const d = await res.json();
      setMessage({ text: d.error || "Failed to save", ok: false });
    }
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/providers/${provider.id}/deactivate`, { method: "POST" });
    if (res.ok) {
      onUpdated();
    } else {
      setMessage({ text: "Failed to delete", ok: false });
    }
    setDeleting(false);
    setConfirmDelete(false);
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/providers/${provider.id}/test`, { method: "POST" });
      const result = await res.json();
      if (result.success) {
        setMessage({
          text: `Connected in ${result.latencyMs}ms — ${result.models.length} model${result.models.length !== 1 ? "s" : ""} discovered${result.note ? ` (${result.note})` : ""}`,
          ok: true,
        });
        onUpdated();
      } else {
        setMessage({ text: result.error || "Connection failed", ok: false });
      }
    } catch {
      setMessage({ text: "Failed to test connection", ok: false });
    }
    setTesting(false);
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand text-sm font-bold">
            {typeInfo?.name.charAt(0) || "?"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{provider.name}</h3>
              <Badge variant={STATUS_VARIANT[provider.status] || "secondary"}>{provider.status}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{typeInfo?.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
            {testing ? "Testing..." : "Test"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setShowConfig(!showConfig); setConfirmDelete(false); }}>
            {showConfig ? "Cancel" : "Edit"}
          </Button>
          {!confirmDelete ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          ) : (
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm?"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {provider.apiKeyRef && (
          <span className="flex items-center gap-1">
            <Key className="h-3 w-3" />
            {authMethod === "oauth_token" ? "OAuth Token" : "API Key"} ····
            {authMethod === "oauth_token" && <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">OAuth</Badge>}
          </span>
        )}
        {provider.baseUrl && (
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {provider.baseUrl}
          </span>
        )}
      </div>

      {provider.models.length > 0 ? (
        <div className="mt-3">
          <button
            onClick={() => setShowModels(!showModels)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showModels ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Check className="h-3 w-3 text-green-600" />
            {provider.models.length} model{provider.models.length !== 1 ? "s" : ""} available
          </button>
          {showModels && (
            <div className="mt-2 space-y-1">
              {provider.models.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  providerId={provider.id}
                  providerType={provider.providerType}
                  isDefault={model.id === defaultModelId}
                  onSetDefault={async () => {
                    await fetch("/api/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ entries: [{ key: "default_model", value: { providerModelId: model.id, modelId: model.modelId, displayName: model.displayName } }] }),
                    });
                    onSetDefault(model.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No models discovered yet — click Test to discover available models.</p>
      )}

      {message && (
        <div className={`mt-3 rounded-md px-3 py-2 text-xs ${message.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {message.text}
        </div>
      )}

      {showConfig && (
        <div className="mt-4 max-w-sm space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Base URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_URLS[provider.providerType] || "https://..."}
              className="h-9"
            />
          </div>

          {provider.providerType !== "ollama" && (
            <div className="space-y-1.5">
              <Label className="text-xs">{authMethod === "oauth_token" ? "OAuth Token" : "API Key"} <span className="text-muted-foreground font-normal">(leave empty to keep current)</span></Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter new key to update"
                className="h-9 font-mono text-xs"
              />
            </div>
          )}

          {authMethod === "oauth_token" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Beta Flags</Label>
                <Input
                  value={betaFlags}
                  onChange={(e) => setBetaFlags(e.target.value)}
                  placeholder={ANTHROPIC_OAUTH_DEFAULTS.betaFlags}
                  className="h-9 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">System Prompt Prefix</Label>
                <Input
                  value={systemPromptPrefix}
                  onChange={(e) => setSystemPromptPrefix(e.target.value)}
                  placeholder={ANTHROPIC_OAUTH_DEFAULTS.systemPromptPrefix}
                  className="h-9 text-xs"
                />
              </div>
            </>
          )}

          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Saving...</> : "Save"}
          </Button>
        </div>
      )}
    </Card>
  );
}

import { PROVIDER_DEFAULTS, DEFAULT_PAGE_SIZE } from "@/lib/client-config";
const DEFAULT_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_DEFAULTS).map(([k, v]) => [k, v.baseUrl])
);

const KEY_PLACEHOLDERS: Record<string, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  ollama: "",
  openai_compatible: "sk-...",
};

const ANTHROPIC_OAUTH_DEFAULTS = {
  betaFlags: "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14",
  systemPromptPrefix: "You are Claude Code, Anthropic's official CLI for Claude.",
  defaultHeaders: {
    "user-agent": "claude-cli/0.1 (external, cli)",
    "x-app": "cli",
    "anthropic-dangerous-direct-browser-access": "true",
  },
};

function AddProviderForm({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [providerType, setProviderType] = useState("ollama");
  const [authMethod, setAuthMethod] = useState<"api_key" | "oauth_token">("api_key");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedType = PROVIDER_TYPES.find((t) => t.id === providerType);

  function handleTypeChange(type: string) {
    setProviderType(type);
    setAuthMethod("api_key");
    setName("");
    setBaseUrl("");
    setApiKey("");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!providerType) return;
    setError("");
    setSubmitting(true);

    const config: Record<string, unknown> = {};
    if (providerType === "anthropic") {
      config.authMethod = authMethod;
      if (authMethod === "oauth_token") {
        config.betaFlags = ANTHROPIC_OAUTH_DEFAULTS.betaFlags;
        config.systemPromptPrefix = ANTHROPIC_OAUTH_DEFAULTS.systemPromptPrefix;
        config.defaultHeaders = ANTHROPIC_OAUTH_DEFAULTS.defaultHeaders;
      }
    }

    const body: Record<string, unknown> = {
      name: name || selectedType?.name || providerType,
      providerType,
      baseUrl: baseUrl || DEFAULT_URLS[providerType] || null,
      apiKeyRef: apiKey || null,
      config,
    };

    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      onCreated();
    } else {
      const d = await res.json();
      setError(d.error || "Failed to create provider");
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="space-y-2">
        <Label>Provider Type</Label>
        <Select value={providerType} onChange={(e) => handleTypeChange(e.target.value)}>
          <option value="">Select a provider...</option>
          {PROVIDER_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        {selectedType && (
          <p className="text-xs text-muted-foreground">{selectedType.description}</p>
        )}
      </div>

      {providerType === "anthropic" && (
        <div className="space-y-2">
          <Label>Authentication Method</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="authMethod" checked={authMethod === "api_key"} onChange={() => setAuthMethod("api_key")} className="accent-brand" />
              API Key
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="authMethod" checked={authMethod === "oauth_token"} onChange={() => setAuthMethod("oauth_token")} className="accent-brand" />
              OAuth Token
            </label>
          </div>
        </div>
      )}

      {providerType && (
        <>
          <div className="space-y-2">
            <Label>Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selectedType?.name || "Provider name"}
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label>Base URL {(providerType === "ollama" || providerType === "openai_compatible") ? <span className="text-destructive">*</span> : <span className="text-muted-foreground font-normal">(optional)</span>}</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_URLS[providerType] || "https://..."}
              className="h-10"
              required={providerType === "ollama" || providerType === "openai_compatible"}
            />
          </div>

          <div className="space-y-2">
            <Label>{providerType === "anthropic" && authMethod === "oauth_token" ? "OAuth Token" : "API Key"} {(providerType === "anthropic" || providerType === "openai" || providerType === "openai_compatible") ? <span className="text-destructive">*</span> : <span className="text-muted-foreground font-normal">(optional)</span>}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={providerType === "anthropic" && authMethod === "oauth_token" ? "OAuth token from Anthropic" : (KEY_PLACEHOLDERS[providerType] || "API key")}
              className="h-10 font-mono text-xs"
              required={providerType === "anthropic" || providerType === "openai" || providerType === "openai_compatible"}
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</> : `Add ${name || selectedType?.name || "Provider"}`}
          </Button>
        </>
      )}
    </form>
  );
}

function ModelRow({ model, providerId, providerType, isDefault, onSetDefault }: {
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
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {model.contextWindow && <span>{(model.contextWindow / 1000).toFixed(0)}K ctx</span>}
          {model.maxOutputTokens && <span>{(model.maxOutputTokens / 1000).toFixed(0)}K out</span>}
          <Button variant="ghost" size="sm" onClick={() => setShowChat(!showChat)} className="h-6 px-2 text-[10px]">
            <Send className="h-3 w-3" /> Try
          </Button>
          <button onClick={onSetDefault} className="p-0.5 transition-colors" title={isDefault ? "Default model" : "Set as default"}>
            <Star className={`h-3.5 w-3.5 ${isDefault ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"}`} />
          </button>
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
