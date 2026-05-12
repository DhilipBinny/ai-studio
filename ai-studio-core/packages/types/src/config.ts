/**
 * Gateway configuration types.
 *
 * Mirrors the shape of ~/.agw/config.json (DEFAULT_CONFIG in src/config.js).
 * Environment variable references like `${VAR}` are resolved at load time,
 * so all string fields hold their resolved values at runtime.
 */

// ──────────────────────────────────────────────
// Provider configs
// ──────────────────────────────────────────────

/** Anthropic provider configuration. */
export interface AnthropicProviderConfig {
  /** API key (standard billing). Resolved from `${ANTHROPIC_API_KEY}`. */
  apiKey: string;
  /** Optional proxy base URL. */
  baseUrl: string;
  /** Default model ID when none is specified. */
  defaultModel: string;
  /** Path to a file containing the API key (alternative to env var). */
  apiKeyFile?: string;
}

/** OpenAI provider configuration. */
export interface OpenAIProviderConfig {
  /** API key. Resolved from `${OPENAI_API_KEY}`. */
  apiKey: string;
  /** Default model ID. */
  defaultModel: string;
  /** Path to a file containing the API key. */
  apiKeyFile?: string;
}

/** Ollama provider configuration. */
export interface OllamaProviderConfig {
  /** Ollama server URL. Resolved from `${OLLAMA_BASE_URL}`. */
  baseUrl: string;
  /** Default model ID. */
  defaultModel: string;
}

/** Kairo Premium provider configuration (proprietary auth via kairo-auth binary). */
export interface KairoPremiumProviderConfig {
  /** Enable/disable premium provider. */
  enabled: boolean;
  /** Auth mode: 'oauth' for subscription token, 'sdk' for Claude CLI proxy. */
  mode: 'oauth' | 'sdk';
  /** Default model (sonnet, opus, haiku). */
  defaultModel: string;
}

/** All configured LLM providers. */
export interface ProvidersConfig {
  anthropic: AnthropicProviderConfig;
  openai: OpenAIProviderConfig;
  ollama: OllamaProviderConfig;
  kairoPremium?: KairoPremiumProviderConfig;
}

// ──────────────────────────────────────────────
// Channel configs
// ──────────────────────────────────────────────

/** Telegram channel configuration. */
export interface TelegramChannelConfig {
  /** Whether the Telegram bot is enabled. */
  enabled: boolean;
  /** Bot token. Resolved from `${TELEGRAM_BOT_TOKEN}`. */
  botToken: string;
  /** Allowed user/group IDs. Empty array means no restriction. */
  allowFrom: number[];
  /** Allow group messages. */
  groupsEnabled: boolean;
  /** In groups, only respond when mentioned or replied to. */
  groupRequireMention: boolean;
  /** Allowed group chat IDs. Empty = all groups allowed. */
  groupAllowFrom: string[];
  /** In groups, only respond to users who are in allowFrom. Default true. */
  groupRequireAllowFrom: boolean;
  /** Path to a file containing the bot token. */
  tokenFile?: string;
  /** Outbound message policy. 'session-only' restricts to contacts with existing sessions. */
  outboundPolicy: 'session-only' | 'unrestricted';
  /** Extra chat IDs allowed for outbound beyond active sessions. */
  outboundAllowlist: string[];
}

/** WhatsApp channel configuration. */
export interface WhatsAppChannelConfig {
  /** Whether the WhatsApp channel is enabled. */
  enabled: boolean;
  /** Allowed phone numbers (E.164 format, e.g. "971501234567"). Empty = no restriction. */
  allowFrom: string[];
  /** Allow group messages. */
  groupsEnabled: boolean;
  /** In groups, only respond when mentioned. */
  groupRequireMention: boolean;
  /** Allowed group JIDs. Empty = all groups allowed. */
  groupAllowFrom: string[];
  /** In groups, only respond to users who are in allowFrom. Default true. */
  groupRequireAllowFrom: boolean;
  /** Send read receipts. */
  sendReadReceipts: boolean;
  /** Outbound message policy. 'session-only' restricts to contacts with existing sessions. */
  outboundPolicy: 'session-only' | 'unrestricted';
  /** Extra JIDs allowed for outbound beyond active sessions (e.g. "6591234567@s.whatsapp.net"). */
  outboundAllowlist: string[];
}

/** All channel configurations. */
export interface ChannelsConfig {
  telegram: TelegramChannelConfig;
  whatsapp: WhatsAppChannelConfig;
}

// ──────────────────────────────────────────────
// Section configs
// ──────────────────────────────────────────────

/** Gateway network settings. */
export interface GatewayNetworkConfig {
  /** HTTP listen port. */
  port: number;
  /** Bind address. */
  host: string;
  /** Bearer token for API authentication. Resolved from `${AGW_TOKEN}`. */
  token: string;
  /** Path to a file containing the token. */
  tokenFile?: string;
  /** Trust proxy headers (X-Forwarded-For). false=direct, true=all, number=hop count. */
  trustProxy?: boolean | number | string;
}

/** Active model selection. */
export interface ModelSelectionConfig {
  /** Primary model in `provider/model-id` format (e.g. `anthropic/claude-sonnet-4-6`). */
  primary: string;
  /** Fallback model used when the primary fails. Empty string means no fallback. */
  fallback: string;
  /** Ordered fallback chain. Tried in sequence when primary fails. */
  fallbackChain?: string[];
}

/** Session expiry settings. */
export interface SessionConfig {
  /** Hour of day (0-23) at which sessions auto-reset. */
  resetHour: number;
  /** Minutes of inactivity before session expires. 0 means disabled. */
  idleMinutes: number;
}

/** Exec tool settings. */
export interface ExecToolConfig {
  /** Whether the exec tool is enabled. */
  enabled: boolean;
  /** Default command timeout in seconds. */
  timeout: number;
}

/** Web search tool settings. */
export interface WebSearchToolConfig {
  /** Whether web search is enabled. */
  enabled: boolean;
  /** Brave Search API key. Resolved from `${BRAVE_API_KEY}`. */
  apiKey: string;
  /** Path to a file containing the API key. */
  apiKeyFile?: string;
}

/** Web fetch tool settings. */
export interface WebFetchToolConfig {
  /** Whether web fetch is enabled. */
  enabled: boolean;
  /** Maximum characters to return from a fetched page. */
  maxChars: number;
  /** Hosts (or host:port) that bypass SSRF private-IP protection. */
  allowPrivate?: string[];
}

/** Email/SMTP tool settings. */
export interface EmailToolConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  allowedDomains: string[];
  allowedRecipients: string[];
  maxRecipientsPerMessage: number;
  rateLimit: {
    perMinute: number;
    perHour: number;
    perDay: number;
    perRecipientPerHour: number;
  };
}

/** Audio transcription tool settings. */
export interface TranscriptionToolConfig {
  /** Whether voice transcription is enabled. */
  enabled: boolean;
  /** Base URL of the OpenAI-compatible STT endpoint (e.g. http://10.0.2.20:5007). */
  baseUrl: string;
  /** Model name to send in requests. */
  model: string;
  /** Language hint (ISO 639-1). Empty = auto-detect. */
  language: string;
}

export interface BrowseToolConfig {
  /** Enable/disable the browse tool (headless Chromium). */
  enabled: boolean;
  /** Chrome extension remote browsing access: 'admin' = admin only, 'all' = all users, false = disabled */
  remoteAccess: 'admin' | 'all' | false;
}

/** Built-in tool configuration. */
export interface ToolsConfig {
  exec: ExecToolConfig;
  webSearch: WebSearchToolConfig;
  webFetch: WebFetchToolConfig;
  email: EmailToolConfig;
  transcription: TranscriptionToolConfig;
  browse: BrowseToolConfig;
}



/** Per-channel visibility for thinking output. */
export interface ThinkingShowConfig {
  web: boolean;
  telegram: boolean;
  whatsapp: boolean;
}

/** Extended thinking / chain-of-thought configuration. */
export interface AgentThinkingConfig {
  /** Whether extended thinking is enabled. */
  enabled: boolean;
  /** Thinking mode: 'adaptive' lets the model decide, 'enabled' uses a fixed budget. */
  mode: 'enabled' | 'adaptive';
  /** Token budget for thinking (used when mode is 'enabled'). */
  budgetTokens: number;
  /** Per-channel visibility of thinking output. */
  showThinking: ThinkingShowConfig;
}

/** Session memory extraction configuration. */
export interface SessionMemoryConfig {
  /** Enable/disable session memory. Default: true. */
  enabled?: boolean;
  /** Model to use for extraction (e.g. 'claude-haiku-4-5-20251001'). */
  extractionModel?: string;
  /** Token count at which first extraction triggers. Default: 8000. */
  initTokenThreshold?: number;
  /** Token growth since last extraction before re-extracting. Default: 4000. */
  growthTokenThreshold?: number;
}

/** Memory search composite-scoring tuning knobs. */
export interface MemoryConfig {
  /**
   * Multiplier applied to PROFILE.md chunks during search.
   * Defaults to 1.5 inside `MemorySystem`. Must be > 0 when set.
   */
  profileBoost?: number;
  /**
   * Recency half-life in days — chunks decay to half their keyword
   * score after this many days. Defaults to 14 inside
   * `MemorySystem`. Must be > 0 when set.
   */
  recencyHalfLifeDays?: number;
}

/** Controls what memory is injected into the system prompt. */
export interface ContextInjectionConfig {
  /** Max chars of PROFILE.md to inject. Default: 3000. */
  profileMaxChars?: number;
  /** Max chars of session memory to inject. Default: 3000. */
  sessionMemoryMaxChars?: number;
  /** Number of daily session file days to inject. 0 = disable. Default: 3. */
  dailySessionDays?: number;
  /** Max chars per daily session file. Default: 1500. */
  dailySessionMaxChars?: number;
}

/** Model routing configuration. */
export interface RoutingConfig {
  /** Enable intelligent model routing. Default: false. */
  enabled?: boolean;
  /** Force a specific model — overrides all routing. Empty string = use router. */
  forceModel?: string;
  /** Model for simple/fast tasks. Default: Haiku. */
  fastModel?: string;
  /** Model for complex/powerful tasks. Default: Opus. */
  powerfulModel?: string;
  /** Use LLM classifier for ambiguous messages (Stage 2). Default: true. */
  llmClassifier?: boolean;
  /** Max message length (chars) considered "short" for Haiku routing. Default: 50. */
  shortMessageThreshold?: number;
  /** Custom patterns that force Opus (regex strings). */
  opusPatterns?: string[];
  /** Custom patterns that force Haiku (regex strings). */
  haikuPatterns?: string[];
}

/**
 * Model indicator visibility level.
 * - 'off': never shown
 * - 'admin_only': shown to admin and power_user roles only
 * - 'all': shown to all users
 */
export type ModelIndicatorVisibility = 'off' | 'admin_only' | 'all';

/** Model indicator visibility per channel. */
export interface ModelIndicatorConfig {
  /** Show model indicator on Telegram. Default: 'off'. */
  telegram: ModelIndicatorVisibility;
  /** Show model indicator on WhatsApp. Default: 'off'. */
  whatsapp: ModelIndicatorVisibility;
  /** Show model indicator on Web chat. Default: 'off'. */
  web: ModelIndicatorVisibility;
}

/** Agent behaviour configuration. */
export interface AgentConfig {
  /** Display name of the assistant. */
  name: string;
  /** IANA timezone for displaying time to the LLM (e.g. "Asia/Singapore"). */
  timezone?: string;
  /** Workspace directory path (resolved to absolute at runtime). */
  workspace: string;
  /** Maximum tool-call rounds per agent turn. */
  maxToolRounds: number;
  /** Context-window usage ratio that triggers hard compaction (0-1). */
  compactionThreshold: number;
  /** Context-window usage ratio that triggers soft compaction / tool eviction (0-1). */
  softCompactionThreshold: number;
  /** Number of recent messages to keep after compaction. */
  keepRecentMessages: number;
  /** Extended thinking / chain-of-thought configuration. */
  thinking?: AgentThinkingConfig;
  /** Session memory (structured per-session notes) configuration. */
  sessionMemory?: SessionMemoryConfig;
  /** Memory search composite-scoring tuning knobs. */
  memory?: MemoryConfig;
  /** Controls what memory is injected into the system prompt. */
  contextInjection?: ContextInjectionConfig;
  /** Model routing configuration. */
  routing?: RoutingConfig;
  /** Show which model responded (per channel). Off by default. */
  showModelIndicator?: ModelIndicatorConfig;
  /** Whether to defer tool loading (only send core set initially; use tool_search for rest). */
  deferToolLoading?: boolean;
  /** Maximum concurrent background tasks allowed. Default: 10. */
  maxBackgroundTasks?: number;
  /** Debug settings (admin only). */
  debug?: {
    /** Record every LLM call (input + output) to JSONL files in workspace/debug/. */
    recordPrompt?: boolean;
  };
}

/** Model capabilities — auto-fetched from provider APIs + admin overrides. */
export interface ModelsCatalogConfig {
  /** Model capabilities keyed by model ID (e.g. "claude-opus-4-7", "gpt-4o"). */
  capabilities: Record<string, Partial<import('./provider').ModelCapabilities>>;
}

/** MCP server configuration section. */
export interface MCPSectionConfig {
  /** MCP servers keyed by server ID. */
  servers: Record<string, import('./mcp').MCPServerConfig>;
}

// ──────────────────────────────────────────────
// Plugin configs
// ──────────────────────────────────────────────

/** CLI plugin configuration. */
export interface CliPluginConfig {
  /** Unique plugin name (lowercase alphanumeric + underscores). */
  name: string;
  /** Binary name to execute (e.g. gh, docker, kubectl). */
  command: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** Whether the plugin is enabled. */
  enabled: boolean;
  /** Command timeout in seconds (1-120). */
  timeout: number;
  /** Allowed subcommands (empty = all allowed). */
  allowedSubcommands: string[];
  /** Always-blocked subcommands. */
  blockedSubcommands: string[];
  /** Subcommands that require user confirmation. */
  requireConfirmation: string[];
  /** Environment variable names to inject from secrets store. */
  env?: string[];
}

/** Describes where media data lives in an HTTP response. */
export interface ResponseMediaMapping {
  /** JSON path to the media field (e.g. "data[0].b64_json", "image", "result.url"). */
  path: string;
  /** How the data is encoded. */
  encoding: 'base64' | 'url';
  /** MIME type of the media (e.g. "image/png"). */
  mimeType: string;
}

/** HTTP plugin endpoint configuration. */
export interface HttpEndpointConfig {
  /** Endpoint name (used in tool name). */
  name: string;
  /** HTTP method. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL path relative to baseUrl. */
  path: string;
  /** Human-readable description. */
  description: string;
  /** Parameter definitions for this endpoint. */
  parameters: Record<string, {
    type: string;
    description?: string;
    required?: boolean;
    default?: unknown;
  }>;
  /** Explicit mapping of media fields in the response. Auto-populated from OpenAPI specs. */
  responseMedia?: ResponseMediaMapping[];
}

/** HTTP plugin auth configuration. */
export interface HttpPluginAuth {
  /** Auth type. */
  type: 'bearer' | 'header' | 'query' | 'basic';
  /** Key path in the secrets store (e.g. "plugins.myapi"). */
  tokenSecret: string;
  /** Header name for 'header' auth type. */
  headerName?: string;
  /** Query parameter name for 'query' auth type. */
  queryParam?: string;
}

/** HTTP plugin configuration. */
export interface HttpPluginConfig {
  /** Unique plugin name (lowercase alphanumeric + underscores). */
  name: string;
  /** Base URL for API requests. */
  baseUrl: string;
  /** Human-readable description. */
  description: string;
  /** Whether the plugin is enabled. */
  enabled: boolean;
  /** Request timeout in seconds (1-600). Higher for slow endpoints like image gen. */
  timeout: number;
  /** Optional authentication configuration. */
  auth?: HttpPluginAuth;
  /** API endpoints exposed as tools. */
  endpoints: HttpEndpointConfig[];
}

/** OpenAPI auto-import service configuration. */
export interface OpenAPIServiceConfig {
  /** Unique service name (lowercase alphanumeric + underscores). */
  name: string;
  /** Base URL of the service (e.g. http://10.0.2.20:5006). */
  baseUrl: string;
  /** Override description. */
  description?: string;
  /** Whether auto-import is enabled. */
  enabled: boolean;
  /** Request timeout in seconds. */
  timeout: number;
  /** Paths to skip during import. */
  skipPaths?: string[];
}

/** Plugin configuration section. */
export interface PluginsConfig {
  /** CLI plugins. */
  cli: CliPluginConfig[];
  /** HTTP plugins. */
  http: HttpPluginConfig[];
  /** OpenAPI services to auto-discover on startup. */
  openapi?: OpenAPIServiceConfig[];
}

// ──────────────────────────────────────────────
// Hooks config
// ──────────────────────────────────────────────

/** A tool hook fires before/after tool execution when the matcher matches. */
export interface ToolHookConfig {
  /** Glob pattern to match tool names (e.g. "exec", "write_*"). */
  matcher: string;
  /** Shell command to execute. Receives tool args on stdin. */
  command: string;
  /** Timeout in ms. */
  timeoutMs?: number;
}

/** A session hook fires on session lifecycle events. */
export interface SessionHookConfig {
  /** Shell command to execute. */
  command: string;
  /** Timeout in ms. */
  timeoutMs?: number;
}

/** Hook configuration — shell commands triggered by agent events. */
export interface HooksConfig {
  /** Hooks that run before tool execution. */
  PreToolUse: ToolHookConfig[];
  /** Hooks that run after tool execution. */
  PostToolUse: ToolHookConfig[];
  /** Hooks that run when a new session starts. */
  SessionStart: SessionHookConfig[];
  /** Hooks that run after context compaction. */
  PostCompact: SessionHookConfig[];
}

// ──────────────────────────────────────────────
// Top-level config
// ──────────────────────────────────────────────

/**
 * Complete gateway configuration object.
 *
 * Loaded from `~/.agw/config.json` with environment variable resolution.
 * This is the runtime shape after `loadConfig()` resolves all `${VAR}` references.
 */
export interface GatewayConfig {
  gateway: GatewayNetworkConfig;
  providers: ProvidersConfig;
  model: ModelSelectionConfig;
  channels: ChannelsConfig;
  session: SessionConfig;
  tools: ToolsConfig;
  agent: AgentConfig;
  models: ModelsCatalogConfig;

  /** MCP server configuration. */
  mcp: MCPSectionConfig;

  /** Plugin configuration (CLI + HTTP). Loaded from plugins.json. */
  plugins?: PluginsConfig;

  /** Hook configuration — shell commands triggered by agent events. */
  hooks?: HooksConfig;

  /** Internal: resolved path to the state directory (~/.agw). Set at runtime. */
  _stateDir?: string;
}
