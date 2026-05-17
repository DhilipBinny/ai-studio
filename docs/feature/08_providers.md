# 08 - LLM Providers

Comprehensive documentation for the LLM Provider system in Kairo Studio, covering provider configuration, API key encryption, model discovery, connectivity testing, quick chat, embedding/rerank models, OAuth support, and SSRF protection.

---

## Architecture Overview

| Layer | Package | Responsibility |
|-------|---------|---------------|
| Core bridge | `ai-studio-core/packages/provider-bridge/` | Provider classes (Anthropic, OpenAI), streaming, failover, model registry, embedding/rerank APIs, test connection |
| Runtime factory | `ai-studio-app/packages/agent-runtime/src/provider-factory.ts` | Creates provider instances from DB config for agent execution |
| App services | `ai-studio-app/web/src/lib/services/` | `provider-test.ts`, `provider-chat.ts`, `validate-provider-url.ts` |
| API routes | `ai-studio-app/web/src/app/api/providers/` | REST endpoints for CRUD, test, chat, models |
| Auth/encryption | `ai-studio-app/packages/auth/src/encryption.ts` | AES-256-GCM encrypt/decrypt for API keys |

---

## 1. Provider Types

| Type | Enum Value | SDK | Auth | Notes |
|------|-----------|-----|------|-------|
| Anthropic | `anthropic` | `@anthropic-ai/sdk` | API key or OAuth token | Supports extended thinking, tool use, prompt caching |
| OpenAI | `openai` | `openai` | API key | GPT-4o, o1, o3, o4, ChatGPT, text-embedding models |
| Ollama | `ollama` | `openai` (via `/v1`) | None (key = `"ollama"`) | Local models, default base URL `http://localhost:11434` |
| Azure OpenAI | `azure_openai` | -- | -- | Enum defined, not yet implemented in test/chat |
| Google | `google` | -- | -- | Enum defined, not yet implemented in test/chat |
| Custom | `custom` | -- | -- | Enum defined, not yet implemented |
| OpenAI-Compatible | `openai_compatible` | `openai` | API key (optional) | Any server with OpenAI-compatible `/v1/models` endpoint |

### Provider Type Enum (DB)
```sql
CREATE TYPE provider_type AS ENUM (
  'anthropic', 'openai', 'ollama', 'azure_openai', 'google', 'custom', 'openai_compatible'
);
```

### Provider Status Enum (DB)
```sql
CREATE TYPE provider_status AS ENUM ('active', 'inactive', 'error');
```

---

## 2. Provider CRUD

### Behavior
- Each provider belongs to a tenant and has a unique name within that tenant.
- API keys are encrypted with AES-256-GCM before storage.
- API keys are always masked as `"****"` in all GET responses.
- Deactivation is a soft operation: sets `is_active=false`, `status='inactive'`, `deactivated_at`.
- The list endpoint includes a subquery `modelCount` and eagerly loads all active models.

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/providers` | PROVIDERS:10 | List providers with pagination + models |
| POST | `/api/providers` | PROVIDERS:20 | Create a new provider |
| GET | `/api/providers/[id]` | PROVIDERS:10 | Get provider detail + models |
| PATCH | `/api/providers/[id]` | PROVIDERS:20 | Update provider (name, URL, key, config) |
| POST | `/api/providers/[id]/deactivate` | PROVIDERS:20 | Soft-deactivate provider |

### Request / Response Shapes

**POST /api/providers** (create)
```json
{
  "name": "Production Anthropic",
  "providerType": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "apiKeyRef": "sk-ant-...",
  "config": {
    "authMethod": "api_key"
  }
}
```

**PATCH /api/providers/[id]** (update -- partial)
```json
{
  "name": "Updated Name",
  "baseUrl": "https://new-endpoint.example.com",
  "apiKeyRef": "new-api-key",
  "config": { "authMethod": "oauth_token", "betaFlags": "..." },
  "status": "active"
}
```

### Validation (Zod)

| Schema | File |
|--------|------|
| `createProviderSchema` | `packages/validation/src/providers.ts` |
| `updateProviderSchema` | `packages/validation/src/providers.ts` |
| `createModelSchema` | `packages/validation/src/providers.ts` |
| `updateModelSchema` | `packages/validation/src/providers.ts` |

Key constraints:
- `name`: 1-255 chars, unique per tenant
- `providerType`: one of the 7 enum values
- `baseUrl`: valid URL, optional
- `config`: freeform object

### DB Table: `providers`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | References `tenants.id`, cascade delete |
| name | text | NOT NULL, unique per tenant |
| provider_type | enum | `provider_type` enum |
| base_url | text | Nullable, validated for SSRF |
| api_key_ref | text | Encrypted ciphertext (`v1:iv:ct:tag`) |
| config | jsonb | Provider-specific config (e.g., `authMethod`, `betaFlags`) |
| status | enum | `active`, `inactive`, `error` |
| is_active | boolean | Soft-delete flag |
| deactivated_at | timestamptz | Set on deactivation |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

**Indexes:** `idx_providers_tenant(tenant_id)`, `idx_providers_status(tenant_id, status)`, unique on `(tenant_id, name)`.

### Security
- API keys encrypted at rest with AES-256-GCM.
- API keys never returned in responses (always masked `"****"`).
- Base URLs validated against SSRF blocklist on create and update.
- All queries scoped by `tenant_id`.
- RBAC: PROVIDERS:10 for read, PROVIDERS:20 for write.
- All mutations audited.

---

## 3. API Key Encryption (AES-256-GCM)

### Implementation
File: `ai-studio-app/packages/auth/src/encryption.ts`

### Encryption
```
encryptSecret(plaintext) -> "v{version}:{iv_base64}:{ciphertext_base64}:{tag_base64}"
```

- **Algorithm:** AES-256-GCM
- **IV length:** 12 bytes (random per encryption)
- **Key source:** `ENCRYPTION_KEY` env var (64-char hex = 32 bytes)
- **Key versioning:** Supports `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, etc.
- **Current version:** `ENCRYPTION_KEY_VERSION` env var (default 1)
- **Auth tag:** GCM authentication tag appended for integrity verification

### Decryption
```
decryptSecret("v1:aGVsbG8=:d29ybGQ=:dGFn") -> plaintext
```
- Parses the version prefix to select the correct key.
- Verifies the auth tag (tamper detection).
- Throws on invalid format or missing key version.

### Detection
```
isEncrypted(value) -> boolean
```
- Pattern: `/^v\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/`

### Usage Points
- Provider `apiKeyRef` on create/update
- Connector `credentialsRef` on create/update
- Connector `connectionConfig.env` values on create/update
- Decrypted just-in-time for test, chat, embedding, and reranking operations

---

## 4. Model Discovery & Management

### Auto-Discovery (via Test Connection)
When a provider is tested, models are automatically discovered and synced:

1. Test endpoint calls the provider's model listing API.
2. Each discovered model is classified by capabilities:
   - `"embedding"` -- model ID contains `embed`, `text-embedding-`, or `voyage`
   - `"reranking"` -- model ID contains `rerank`
   - `"chat"` -- everything else
3. Models are upserted: existing models updated, new models inserted.
4. Models no longer returned by the API are deactivated (`is_active=false`).

### Manual Model Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/providers/[id]/models` | PROVIDERS:10 | List all models for a provider |
| POST | `/api/providers/[id]/models` | PROVIDERS:20 | Manually add a model |
| PATCH | `/api/providers/[id]/models/[mid]` | PROVIDERS:20 | Update model metadata |

**POST /api/providers/[id]/models** (create)
```json
{
  "modelId": "claude-opus-4-7",
  "displayName": "Claude Opus 4.7",
  "capabilities": ["chat"],
  "contextWindow": 200000,
  "maxOutputTokens": 16384,
  "costPerInputToken": "0.000015",
  "costPerOutputToken": "0.000075"
}
```

**PATCH /api/providers/[id]/models/[mid]** (update)
```json
{
  "displayName": "Updated Name",
  "capabilities": ["chat", "embedding"],
  "isActive": false,
  "costPerInputToken": "0.000010"
}
```

### DB Table: `provider_models`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | Cascade |
| provider_id | uuid FK | Cascade to `providers.id` |
| model_id | text | Provider's model identifier (e.g., `"claude-sonnet-4-6"`) |
| display_name | text | Human-friendly name |
| capabilities | jsonb | Array of strings: `["chat"]`, `["embedding"]`, `["reranking"]` |
| context_window | int | Nullable, max input tokens |
| max_output_tokens | int | Nullable |
| cost_per_input_token | numeric(12,10) | Default `"0"` |
| cost_per_output_token | numeric(12,10) | Default `"0"` |
| is_active | boolean | Default true |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

**Constraints:** Unique on `(tenant_id, provider_id, model_id)`.
**Indexes:** `idx_provider_models_tenant(tenant_id)`, `idx_provider_models_provider(provider_id)`.

---

## 5. Provider Testing (Connectivity Check)

### Behavior
Tests provider connectivity, validates credentials, and discovers available models.

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/providers/[id]/test` | PROVIDERS:10 | Test connection + discover models |

### Test Flow
1. Load provider from DB (scoped by tenant).
2. Decrypt API key if encrypted.
3. Validate base URL for SSRF.
4. Call provider-specific test method.
5. On success with models: upsert models, deactivate stale ones, set status to `active`.
6. On failure: set status to `error`.
7. Create audit entry with latency, success, model count, and any error.

### Per-Provider Test Methods

| Provider | Method | Timeout |
|----------|--------|---------|
| Anthropic | `client.models.list()` | 15s (enforced via AbortController with clearTimeout in finally block) |
| OpenAI | `client.models.list()` (filtered to gpt/o1/o3/o4/chatgpt/text-embedding) | 15s (enforced via AbortController) |
| Ollama | `fetch(baseUrl/api/tags)` | 15s (enforced via AbortController) |
| OpenAI-Compatible | `client.models.list()` | 15s (enforced via AbortController) |

All four provider types now have functioning 15s timeouts via AbortController.

### Response Shape
```json
{
  "success": true,
  "latencyMs": 423,
  "note": "Rate limited -- auth is valid",
  "models": [
    {
      "modelId": "claude-sonnet-4-6",
      "displayName": "Claude 4.6 Sonnet",
      "contextWindow": 200000,
      "maxOutputTokens": 8192
    }
  ]
}
```

### Error Handling
- 429 (rate limit) on Anthropic: treated as success (auth is valid).
- 401: "Invalid API key" or "Invalid or expired OAuth token".
- 403: "Access denied".
- ECONNREFUSED (Ollama): "Cannot connect to Ollama at {url} -- is it running?"

---

## 6. Quick Chat (Provider-Level Chat)

### Behavior
Sends a single message to a specific model on a provider. No tools, no thinking, no system prompt (except for OAuth Anthropic). Used for quick validation and testing.

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/providers/[id]/chat` | PROVIDERS:10 | Send a quick chat message |

### Request Shape
```json
{
  "modelId": "claude-sonnet-4-6",
  "message": "Hello, can you hear me?"
}
```

### Response Shape
```json
{
  "success": true,
  "response": "Hello! Yes, I can hear you. How can I help?",
  "latencyMs": 1234,
  "inputTokens": 12,
  "outputTokens": 45
}
```

### Implementation Details
- File: `web/src/lib/services/provider-chat.ts`
- Anthropic: Uses `client.messages.create()` with `max_tokens=1024`.
  - OAuth mode: adds a system prompt prefix (`systemPromptPrefix` from config).
- OpenAI / Ollama / OpenAI-Compatible: Uses `client.chat.completions.create()` with `max_tokens=1024`.
  - Ollama: appends `/v1` to base URL, uses `"ollama"` as API key.
- SSRF validation on base URL before any outbound request.
- API key decrypted just-in-time.

---

## 7. SSRF Protection (validateProviderUrl)

### Implementation
File: `ai-studio-app/web/src/lib/services/validate-provider-url.ts`

### Validation Rules

| Check | Blocked |
|-------|---------|
| Scheme | Only `http:` and `https:` allowed |
| Loopback | `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` |
| IPv4 private ranges | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Link-local | `169.254.0.0/16` |
| CGNAT | `100.64.0.0/10` |
| Reserved | `0.0.0.0/8`, `240.0.0.0+` |
| IPv6 private | `::1`, `::`, `fe80:` (link-local), `fc`/`fd` (ULA) |
| IPv4-mapped IPv6 | `::ffff:10.x.x.x` etc. (delegates to IPv4 check) |
| Cloud metadata | `metadata.google.internal`, `metadata.google.com`, `instance-data` |

### Enforcement Points
1. Provider create (`POST /api/providers`) -- on `baseUrl`.
2. Provider update (`PATCH /api/providers/[id]`) -- on `baseUrl`.
3. Provider test (`testProvider`) -- before outbound request.
4. Quick chat (`quickChat`) -- before outbound request.
5. Provider factory (`createProvider` in agent-runtime) -- before creating SDK client.

---

## 8. Embedding Models

### Behavior
A dedicated endpoint lists all active models with the `"embedding"` capability, grouped by provider.

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/providers/embedding-models` | KNOWLEDGE:10 | List embedding-capable models |

### Query
Uses a JSONB containment check:
```sql
provider_models.capabilities::jsonb @> '"embedding"'::jsonb
```

### Response Shape
```json
{
  "data": [
    {
      "id": "provider-uuid",
      "name": "OpenAI Production",
      "providerType": "openai",
      "models": [
        { "modelId": "text-embedding-3-small", "displayName": "text-embedding-3-small" },
        { "modelId": "text-embedding-3-large", "displayName": "text-embedding-3-large" }
      ]
    }
  ]
}
```

### Provider-Bridge Embedding
File: `ai-studio-core/packages/provider-bridge/src/embedding.ts`

- Uses the OpenAI embeddings API (`/v1/embeddings`) for all provider-based embedding.
- Batches in groups of 100.
- Anthropic explicitly throws: "Anthropic does not support embeddings."
- Ollama works via OpenAI-compatible endpoint (no API key needed).

---

## 9. Re-ranking Models

### Behavior
A dedicated endpoint lists all active models with the `"reranking"` capability, grouped by provider.

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/providers/rerank-models` | KNOWLEDGE:10 | List rerank-capable models |

### Query
```sql
provider_models.capabilities::jsonb @> '"reranking"'::jsonb
```

### Response Shape
Same structure as embedding-models endpoint.

### Provider-Bridge Reranking
File: `ai-studio-core/packages/provider-bridge/src/reranker.ts`

- Calls `/v1/rerank` via HTTP POST with Bearer auth.
- Request: `{ model, query, documents, top_n }`
- Response: `{ results: [{ index, relevance_score }] }`
- Default model: `rerank-v3.5`.
- Built-in reranking handled at the application layer (not provider-bridge).

---

## 10. OAuth Token Support (Anthropic)

### Behavior
Anthropic providers can use OAuth bearer tokens instead of API keys. This enables Claude Pro/Max subscription usage without API key billing.

### Configuration
Set in the provider's `config` JSON:
```json
{
  "authMethod": "oauth_token",
  "betaFlags": "claude-code-20250219,oauth-2025-04-20,...",
  "defaultHeaders": { "custom-header": "value" },
  "systemPromptPrefix": "You are Claude Code, Anthropic's official CLI for Claude."
}
```

### SDK Configuration (when authMethod = "oauth_token")
```typescript
{
  apiKey: "",           // empty string required
  authToken: token,     // the OAuth bearer token
  defaultHeaders: {
    ...customHeaders,
    "anthropic-beta": betaFlags,
  }
}
```

### OAuth Provider (provider-bridge)
File: `ai-studio-core/packages/provider-bridge/src/anthropic-oauth.ts`

The `OAuthProvider` class provides:
- Header injection defense: tokens with CRLF characters are rejected.
- Claude Code identity headers: `user-agent`, `x-app`, `anthropic-dangerous-direct-browser-access`.
- Default beta flags for OAuth mode.
- `testOAuthConnection()` -- verifies auth via `client.models.list()`.
- `listModels()` -- fetches available models for the token.
- Streaming timeouts: 60s TTFT, 120s idle between chunks.

### OAuth in Test & Chat
Both `provider-test.ts` and `provider-chat.ts` check `config.authMethod === "oauth_token"` and configure the SDK client accordingly:
- API key set to empty string.
- `authToken` set to the decrypted token value.
- Beta flags and custom headers applied from config.

---

## 11. Provider-Bridge Core Classes

### Streaming Timeout Utility
File: `ai-studio-core/packages/provider-bridge/src/streaming-timeout.ts`

The `createStreamingTimeout` utility is used by both `AnthropicProvider` and `OpenAIProvider` to enforce time-to-first-token (TTFT) and idle-between-chunks timeouts during streaming responses. It provides:
- Configurable TTFT timeout (time allowed before the first chunk arrives).
- Configurable idle timeout (max time between consecutive chunks).
- Returns a controller that resets on each chunk and can be checked/cancelled.

### Error Classification System
File: `ai-studio-core/packages/provider-bridge/src/errors.ts`

Provides `classifyError(error)` which categorizes provider errors into types (auth, rate_limit, timeout, network, server, unknown) and `logClassifiedError(error, context)` for structured error logging with classification metadata.

### Model Capabilities Registry
File: `ai-studio-core/packages/provider-bridge/src/models.ts`

Provides `getModelCapabilities(modelId)` which returns known capabilities (context window, max output tokens, supports tools, supports thinking, etc.) for well-known models. Also provides `estimateCost(modelId, inputTokens, outputTokens)` for token cost estimation and priority-based model lookup for failover scenarios.

### AnthropicProvider
File: `ai-studio-core/packages/provider-bridge/src/anthropic.ts`

- Implements `ProviderInterface.chat()`.
- Supports: streaming, tool calling, extended thinking, structured system prompts, prompt caching.
- Streaming with timeout (`createStreamingTimeout`).
- Detailed error logging: status, rate limit headers, retry-after.
- Cache usage logging: cache_read_input_tokens, cache_creation_input_tokens.

### OpenAIProvider
File: `ai-studio-core/packages/provider-bridge/src/openai.ts`

- Implements `ProviderInterface.chat()`.
- Used for OpenAI, Ollama (with `/v1` suffix), and OpenAI-compatible providers.
- Supports: streaming, tool calling, reasoning content (`reasoning_content` delta).
- Streaming with timeout (`createStreamingTimeout`).

### ProviderRegistry
File: `ai-studio-core/packages/provider-bridge/src/registry.ts`

- Manages multiple provider instances.
- Supports `callWithFailover()`: primary -> fallback chain with retry (up to 3 retries per provider).
- Supports `SecretsResolver` interface for key injection.
- Configurable via `GatewayConfig`.
- Auto-initializes providers lazily on first call.

### Provider Factory (agent-runtime)
File: `ai-studio-app/packages/agent-runtime/src/provider-factory.ts`

- `createProvider(config)` -- creates the correct provider instance from DB config.
- Handles API key decryption via `resolveSecret()`.
- Validates base URL for SSRF before instantiation.
- Routes to `AnthropicProvider` or `OpenAIProvider` based on `providerType`.
- OAuth Anthropic: passes `authToken`, `defaultHeaders`, `systemPromptPrefix`.

---

## Key Files Reference

| Purpose | Path |
|---------|------|
| Provider schema | `packages/database/src/schema/providers.ts` |
| Provider enums | `packages/database/src/schema/enums.ts` |
| Provider validation | `packages/validation/src/providers.ts` |
| Provider API (list/create) | `web/src/app/api/providers/route.ts` |
| Provider API (get/update) | `web/src/app/api/providers/[id]/route.ts` |
| Provider test | `web/src/app/api/providers/[id]/test/route.ts` |
| Provider chat | `web/src/app/api/providers/[id]/chat/route.ts` |
| Provider deactivate | `web/src/app/api/providers/[id]/deactivate/route.ts` |
| Model API (list/create) | `web/src/app/api/providers/[id]/models/route.ts` |
| Model API (update) | `web/src/app/api/providers/[id]/models/[mid]/route.ts` |
| Embedding models | `web/src/app/api/providers/embedding-models/route.ts` |
| Rerank models | `web/src/app/api/providers/rerank-models/route.ts` |
| Test service | `web/src/lib/services/provider-test.ts` |
| Chat service | `web/src/lib/services/provider-chat.ts` |
| SSRF validator | `web/src/lib/services/validate-provider-url.ts` |
| Encryption | `packages/auth/src/encryption.ts` |
| Provider factory | `packages/agent-runtime/src/provider-factory.ts` |
| Anthropic provider | `ai-studio-core/packages/provider-bridge/src/anthropic.ts` |
| Anthropic OAuth | `ai-studio-core/packages/provider-bridge/src/anthropic-oauth.ts` |
| OpenAI provider | `ai-studio-core/packages/provider-bridge/src/openai.ts` |
| Provider registry | `ai-studio-core/packages/provider-bridge/src/registry.ts` |
| Embedding bridge | `ai-studio-core/packages/provider-bridge/src/embedding.ts` |
| Reranker bridge | `ai-studio-core/packages/provider-bridge/src/reranker.ts` |
| Streaming timeout | `ai-studio-core/packages/provider-bridge/src/streaming-timeout.ts` |
| Error classification | `ai-studio-core/packages/provider-bridge/src/errors.ts` |
| Test connection (core) | ~~`ai-studio-core/packages/provider-bridge/src/test-connection.ts`~~ (removed — stale duplicate) |
| Model capabilities | `ai-studio-core/packages/provider-bridge/src/models.ts` |

**Note:** The stale `test-connection.ts` in `provider-bridge/src/` has been removed. The app-layer `provider-test.ts` (`web/src/lib/services/`) is the single source of test-connection logic used by the API routes.
| UI page | `web/src/app/(platform)/providers/page.tsx` |
