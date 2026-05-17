"use client";

import { useState, useEffect } from "react";
import { Loader2, Cpu, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import type { EmbeddingProvider } from "./types";

interface CreateKBFormProps {
  onCreated: () => void;
}

export function CreateKBForm({ onCreated }: CreateKBFormProps) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    embeddingSource: "builtin" as "builtin" | "provider",
    embeddingProviderId: "",
    embeddingModel: "Xenova/bge-small-en-v1.5",
    embeddingDimension: 384,
    chunkMethod: "recursive" as "recursive" | "parent_child",
    rerankSource: "" as "" | "builtin" | "provider",
    rerankProviderId: "",
    rerankModel: "",
  });
  const [embeddingProviders, setEmbeddingProviders] = useState<EmbeddingProvider[]>([]);
  const [rerankProviders, setRerankProviders] = useState<EmbeddingProvider[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/providers/embedding-models")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setEmbeddingProviders(d.data); })
      .catch(() => {});
    fetch("/api/providers/rerank-models")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setRerankProviders(d.data); })
      .catch(() => {});
  }, []);

  const selectedProvider = embeddingProviders.find((p) => p.id === form.embeddingProviderId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (form.embeddingSource === "provider" && !form.embeddingProviderId) {
      setError("Please select an embedding provider.");
      return;
    }
    if (form.embeddingSource === "provider" && !form.embeddingModel) {
      setError("Please select an embedding model.");
      return;
    }

    setSubmitting(true);
    const chunkConfig: Record<string, unknown> = form.chunkMethod === "parent_child"
      ? { method: "parent_child", parent_chunk_size: 2048, child_chunk_size: 512, chunk_overlap: 100 }
      : { method: "recursive", chunk_size: 2048, chunk_overlap: 200 };

    const res = await fetch("/api/knowledge-bases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        embeddingSource: form.embeddingSource,
        embeddingProviderId: form.embeddingSource === "provider" ? form.embeddingProviderId : null,
        embeddingModel: form.embeddingModel,
        embeddingDimension: form.embeddingDimension,
        rerankSource: form.rerankSource || null,
        rerankProviderId: form.rerankSource === "provider" ? form.rerankProviderId : null,
        rerankModel: form.rerankModel || null,
        chunkConfig,
      }),
    });
    if (res.ok) {
      onCreated();
    } else {
      const d = await res.json();
      setError(d.error || "Failed");
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={error} />

      <div className="space-y-2">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          placeholder="Product Documentation"
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Collection of product docs for support agents"
          rows={2}
        />
      </div>

      <div className="border border-border rounded-lg p-3 space-y-3">
        <Label className="text-sm font-medium">Embedding Source</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input
              type="radio"
              name="embeddingSource"
              value="builtin"
              checked={form.embeddingSource === "builtin"}
              onChange={() => setForm((f) => ({
                ...f,
                embeddingSource: "builtin",
                embeddingProviderId: "",
                embeddingModel: "Xenova/bge-small-en-v1.5",
                embeddingDimension: 384,
              }))}
              className="mt-1"
            />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Cpu className="h-3.5 w-3.5" /> Built-in (free, no setup)
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                bge-small-en-v1.5 — 384 dims, runs on CPU. Good for getting started.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input
              type="radio"
              name="embeddingSource"
              value="provider"
              checked={form.embeddingSource === "provider"}
              onChange={() => setForm((f) => ({
                ...f,
                embeddingSource: "provider",
                embeddingModel: "",
                embeddingDimension: 1024,
              }))}
              className="mt-1"
            />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Cloud className="h-3.5 w-3.5" /> External Provider
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                OpenAI, Ollama, Voyage AI, or any compatible endpoint.
              </p>
            </div>
          </label>
        </div>

        {form.embeddingSource === "provider" && (
          <div className="space-y-3 pt-2 border-t">
            {embeddingProviders.length === 0 ? (
              <p className="text-xs text-amber-600">
                No embedding-capable providers found. Add a provider with embedding models first (test connection to discover them).
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <Select
                    value={form.embeddingProviderId}
                    onChange={(e) => {
                      const prov = embeddingProviders.find((p) => p.id === e.target.value);
                      setForm((f) => ({
                        ...f,
                        embeddingProviderId: e.target.value,
                        embeddingModel: prov?.models[0]?.modelId || "",
                      }));
                    }}
                  >
                    <option value="">Select provider...</option>
                    {embeddingProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.providerType})</option>
                    ))}
                  </Select>
                </div>
                {selectedProvider && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Model</Label>
                    <Select
                      value={form.embeddingModel}
                      onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))}
                    >
                      {selectedProvider.models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="border border-border rounded-lg p-3 space-y-2">
        <Label className="text-sm font-medium">Chunking Method</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input
              type="radio"
              name="chunkMethod"
              value="recursive"
              checked={form.chunkMethod === "recursive"}
              onChange={() => setForm((f) => ({ ...f, chunkMethod: "recursive" }))}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium">Standard</p>
              <p className="text-xs text-muted-foreground">
                Recursive splitting with contextual prefix. Good for most documents.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input
              type="radio"
              name="chunkMethod"
              value="parent_child"
              checked={form.chunkMethod === "parent_child"}
              onChange={() => setForm((f) => ({ ...f, chunkMethod: "parent_child" }))}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium">Parent-Child</p>
              <p className="text-xs text-muted-foreground">
                Small chunks for precise search, returns parent chunk for broader context. Best for detailed technical docs.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="border border-border rounded-lg p-3 space-y-2">
        <Label className="text-sm font-medium">Re-ranking</Label>
        <Select
          value={form.rerankSource}
          onChange={(e) => setForm((f) => ({
            ...f,
            rerankSource: e.target.value as "" | "builtin" | "provider",
            rerankProviderId: "",
            rerankModel: "",
          }))}
        >
          <option value="">Disabled (default)</option>
          <option value="builtin">Built-in (ms-marco-MiniLM, CPU, free)</option>
          <option value="provider">External Provider (Cohere, Voyage, Jina)</option>
        </Select>
        <p className="text-xs text-muted-foreground">
          Re-ranking scores each result against the query for better precision. Adds ~50-200ms latency.
        </p>

        {form.rerankSource === "provider" && (
          <div className="space-y-3 pt-2 border-t">
            {rerankProviders.length === 0 ? (
              <p className="text-xs text-amber-600">
                No rerank-capable providers found. Add a provider with rerank models first.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <Select
                    value={form.rerankProviderId}
                    onChange={(e) => {
                      const prov = rerankProviders.find((p) => p.id === e.target.value);
                      setForm((f) => ({
                        ...f,
                        rerankProviderId: e.target.value,
                        rerankModel: prov?.models[0]?.modelId || "",
                      }));
                    }}
                  >
                    <option value="">Select provider...</option>
                    {rerankProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.providerType})</option>
                    ))}
                  </Select>
                </div>
                {form.rerankProviderId && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Model</Label>
                    <Select
                      value={form.rerankModel}
                      onChange={(e) => setForm((f) => ({ ...f, rerankModel: e.target.value }))}
                    >
                      {rerankProviders.find((p) => p.id === form.rerankProviderId)?.models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</>
          : "Create"}
      </Button>
    </form>
  );
}
