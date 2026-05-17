"use client";

import { useState } from "react";
import { TestTube, Loader2, Trash2, Key, Globe, ChevronDown, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PROVIDER_DEFAULTS } from "@/lib/client-config";
import { STATUS_VARIANT } from "@/lib/constants";
import { PROVIDER_TYPES, type Provider } from "./types";
import { ModelRow } from "./model-row";

export const DEFAULT_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_DEFAULTS).map(([k, v]) => [k, v.baseUrl])
);

export const KEY_PLACEHOLDERS: Record<string, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  ollama: "",
  openai_compatible: "sk-...",
};

export const ANTHROPIC_OAUTH_DEFAULTS = {
  betaFlags: "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14",
  systemPromptPrefix: "You are Claude Code, Anthropic's official CLI for Claude.",
  defaultHeaders: {
    "user-agent": "claude-cli/0.1 (external, cli)",
    "x-app": "cli",
    "anthropic-dangerous-direct-browser-access": "true",
  },
};

export function ProviderCard({ provider, onUpdated, defaultModelId, onSetDefault }: {
  provider: Provider;
  onUpdated: () => void;
  defaultModelId: string | null;
  onSetDefault: (id: string) => void;
}) {
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
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
    setShowDeleteDialog(false);
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
            {provider.name.charAt(0).toUpperCase()}
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
          <Button variant="outline" size="sm" onClick={() => { setShowConfig(!showConfig); setShowDeleteDialog(false); }}>
            {showConfig ? "Cancel" : "Edit"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowDeleteDialog(true)} aria-label="Delete provider">
            <Trash2 className="h-3 w-3" />
          </Button>
          <ConfirmDialog
            open={showDeleteDialog}
            onOpenChange={setShowDeleteDialog}
            onConfirm={handleDelete}
            title="Delete provider"
            description={`Are you sure you want to delete "${provider.name}"? Agents using this provider will stop working.`}
            confirmLabel="Delete"
            loading={deleting}
          />
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
            {provider.models.length} model{provider.models.length !== 1 ? "s" : ""}
            {(() => {
              const caps = provider.models.reduce<Record<string, number>>((acc, m) => {
                const cap = (m.capabilities as string[])?.[0] || "chat";
                acc[cap] = (acc[cap] || 0) + 1;
                return acc;
              }, {});
              const parts = Object.entries(caps).map(([k, v]) => `${v} ${k}`);
              return parts.length > 1 ? ` (${parts.join(", ")})` : "";
            })()}
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
