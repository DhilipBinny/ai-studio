"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { Plus, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { PROVIDER_TYPES, type Provider } from "./components/types";
import { ProviderCard } from "./components/provider-card";
import { AddProviderForm } from "./components/add-provider-form";

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
      <PageHeader title="Providers" description="Manage AI providers — chat models, embedding models, and re-ranking services.">
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
          description="Connect AI providers for chat, embeddings, and re-ranking. Supports Anthropic, OpenAI, Ollama, Voyage AI, Cohere, and any OpenAI-compatible endpoint."
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

      {!loading && providers.length > 0 && (
        <Card className="p-4 mt-2 bg-muted/30 border-dashed">
          <p className="text-xs font-medium mb-2">Provider Capabilities</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-0.5">Chat Models</p>
              <p>Used by agents for conversation. Anthropic, OpenAI, Ollama, and compatible endpoints.</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-0.5">Embedding Models</p>
              <p>Used by Knowledge Bases to vectorize documents. OpenAI, Ollama, Voyage AI, NVIDIA. Models tagged automatically on Test Connection.</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-0.5">Re-ranking Models</p>
              <p>Used by Knowledge Bases to improve search precision. Cohere, Voyage AI, Jina. Add as OpenAI Compatible provider.</p>
            </div>
          </div>
        </Card>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd} size="xl">
        <DialogContent onClose={() => setShowAdd(false)}>
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
