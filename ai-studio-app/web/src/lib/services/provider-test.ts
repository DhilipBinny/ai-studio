/**
 * Provider Test Service
 *
 * Tests provider connectivity and discovers available models.
 * This code is duplicated from ai-studio-core/packages/provider-bridge/src/test-connection.ts
 * TODO: Replace with import from @ais/provider-bridge once core workspace is linked.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  note?: string;
  models: DiscoveredModel[];
}

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

interface ProviderRow {
  providerType: string;
  apiKeyRef: string | null;
  baseUrl: string | null;
  config: Record<string, unknown>;
}

const TEST_TIMEOUT_MS = 15_000;

export async function testProvider(provider: ProviderRow): Promise<TestResult> {
  const start = Date.now();

  try {
    switch (provider.providerType) {
      case "anthropic":
        return await testAnthropic(provider, start);
      case "openai":
        return await testOpenAI(provider, start);
      case "ollama":
        return await testOllama(provider, start);
      case "openai_compatible":
        return await testOpenAICompatible(provider, start);
      default:
        return { success: false, latencyMs: 0, error: `Unknown provider type: ${provider.providerType}`, models: [] };
    }
  } catch (e) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
      models: [],
    };
  }
}

async function testAnthropic(provider: ProviderRow, start: number): Promise<TestResult> {
  const isOAuth = provider.config?.authMethod === "oauth_token";
  const clientOpts: Record<string, unknown> = {};

  if (isOAuth) {
    const betaFlags = (provider.config?.betaFlags as string) || "";
    const defaultHeaders = (provider.config?.defaultHeaders as Record<string, string>) || {};
    clientOpts.apiKey = "";
    clientOpts.authToken = provider.apiKeyRef;
    if (betaFlags || Object.keys(defaultHeaders).length > 0) {
      clientOpts.defaultHeaders = {
        ...defaultHeaders,
        ...(betaFlags ? { "anthropic-beta": betaFlags } : {}),
      };
    }
  } else {
    clientOpts.apiKey = provider.apiKeyRef || "";
  }

  if (provider.baseUrl) {
    clientOpts.baseURL = provider.baseUrl;
  }

  const client = new Anthropic(clientOpts as ConstructorParameters<typeof Anthropic>[0]);

  try {
    const response = await client.models.list();
    const latencyMs = Date.now() - start;
    const models: DiscoveredModel[] = response.data.map((m) => {
      const raw = m as unknown as Record<string, unknown>;
      return {
        modelId: raw.id as string,
        displayName: (raw.display_name as string) || (raw.id as string),
        contextWindow: (raw.max_input_tokens as number) || null,
        maxOutputTokens: (raw.max_tokens as number) || null,
      };
    });
    return { success: true, latencyMs, models };
  } catch (e) {
    const err = e as Error & { status?: number };
    const latencyMs = Date.now() - start;
    if (err.status === 429) return { success: true, latencyMs, note: "Rate limited — auth is valid", models: [] };
    if (err.status === 401) return { success: false, latencyMs, error: isOAuth ? "Invalid or expired OAuth token (401)" : "Invalid API key (401)", models: [] };
    if (err.status === 403) return { success: false, latencyMs, error: "Access denied (403)", models: [] };
    if (err.name === "AbortError") return { success: false, latencyMs, error: "Connection timed out", models: [] };
    return { success: false, latencyMs, error: err.message || String(e), models: [] };
  }
}

async function testOpenAI(provider: ProviderRow, start: number): Promise<TestResult> {
  const client = new OpenAI({
    apiKey: provider.apiKeyRef || "",
    ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
  });

  try {
    const response = await client.models.list();
    const latencyMs = Date.now() - start;
    const models: DiscoveredModel[] = [];
    for await (const m of response) {
      models.push({
        modelId: (m as unknown as Record<string, unknown>).id as string,
        displayName: (m as unknown as Record<string, unknown>).id as string,
        contextWindow: null,
        maxOutputTokens: null,
      });
    }
    const relevant = models.filter((m) =>
      m.modelId.startsWith("gpt-") || m.modelId.startsWith("o1") ||
      m.modelId.startsWith("o3") || m.modelId.startsWith("o4") ||
      m.modelId.startsWith("chatgpt") ||
      m.modelId.startsWith("text-embedding-")
    );
    return { success: true, latencyMs, models: relevant.length > 0 ? relevant : models.slice(0, 20) };
  } catch (e) {
    const err = e as Error & { status?: number };
    const latencyMs = Date.now() - start;
    if (err.status === 401) return { success: false, latencyMs, error: "Invalid API key (401)", models: [] };
    return { success: false, latencyMs, error: err.message || String(e), models: [] };
  }
}

async function testOllama(provider: ProviderRow, start: number): Promise<TestResult> {
  const baseUrl = provider.baseUrl || "http://localhost:11434";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { success: false, latencyMs, error: `Ollama returned ${res.status}`, models: [] };
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models: DiscoveredModel[] = (data.models || []).map((m) => ({
      modelId: m.name, displayName: m.name, contextWindow: null, maxOutputTokens: null,
    }));
    return { success: true, latencyMs, models };
  } catch (e) {
    const latencyMs = Date.now() - start;
    if ((e as Error).name === "AbortError") return { success: false, latencyMs, error: "Connection timed out", models: [] };
    if ((e as Error).message?.includes("ECONNREFUSED")) return { success: false, latencyMs, error: `Cannot connect to Ollama at ${baseUrl} — is it running?`, models: [] };
    return { success: false, latencyMs, error: (e as Error).message || String(e), models: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function testOpenAICompatible(provider: ProviderRow, start: number): Promise<TestResult> {
  if (!provider.baseUrl) return { success: false, latencyMs: 0, error: "Base URL is required", models: [] };
  const client = new OpenAI({ apiKey: provider.apiKeyRef || "not-needed", baseURL: provider.baseUrl });

  try {
    const response = await client.models.list();
    const latencyMs = Date.now() - start;
    const models: DiscoveredModel[] = [];
    for await (const m of response) {
      models.push({
        modelId: (m as unknown as Record<string, unknown>).id as string,
        displayName: (m as unknown as Record<string, unknown>).id as string,
        contextWindow: null, maxOutputTokens: null,
      });
    }
    return { success: true, latencyMs, models };
  } catch (e) {
    const latencyMs = Date.now() - start;
    return { success: false, latencyMs, error: (e as Error).message || String(e), models: [] };
  }
}
