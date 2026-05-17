"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { PROVIDER_TYPES } from "./types";
import { DEFAULT_URLS, KEY_PLACEHOLDERS, ANTHROPIC_OAUTH_DEFAULTS } from "./provider-card";

export function AddProviderForm({ onCreated }: { onCreated: () => void }) {
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
      <FormError message={error} />

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
