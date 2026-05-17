import type { GatewayConfig, ProviderInterface, ProviderResponse, ChatArgs, AgwLogger } from '@ais/types';
import { noopLogger } from '@ais/types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { classifyError, logClassifiedError } from './errors';

export interface SecretsResolver {
  get(namespace: string, key: string): string | undefined;
}

export interface ProviderInfo {
  name: string;
  authType?: string;
}

interface FailoverEvent {
  ts: string;
  from: string;
  to: string;
  error: string;
}

export class ProviderRegistry {
  private providers: Record<string, ProviderInterface> = {};
  private config: GatewayConfig;
  private initPromise: Promise<void> | null = null;
  private failoverLog: FailoverEvent[] = [];
  private secretsResolver?: SecretsResolver;
  private log: AgwLogger;
  private customProviderInit?: (registry: ProviderRegistry) => Promise<void>;

  constructor(config: GatewayConfig, logger?: AgwLogger) {
    this.config = config;
    this.log = logger ?? noopLogger;
  }

  setSecretsResolver(resolver: SecretsResolver): void {
    this.secretsResolver = resolver;
  }

  setCustomProviderInit(init: (registry: ProviderRegistry) => Promise<void>): void {
    this.customProviderInit = init;
  }

  addProvider(name: string, provider: ProviderInterface): void {
    this.providers[name] = provider;
  }

  private async initProviders(): Promise<void> {
    const cfg = this.config.providers;

    const anthropicApiKey = this.secretsResolver?.get('providers.anthropic', 'apiKey')
      || cfg.anthropic?.apiKey || '';
    const anthropicBaseUrl = this.secretsResolver?.get('providers.anthropic', 'baseUrl')
      || process.env.ANTHROPIC_BASE_URL || cfg.anthropic?.baseUrl || '';

    if (anthropicApiKey) {
      this.providers.anthropic = new AnthropicProvider(
        { apiKey: anthropicApiKey, baseUrl: anthropicBaseUrl || undefined, defaultModel: cfg.anthropic?.defaultModel || 'claude-sonnet-4-6' },
        this.config,
        this.log,
      );
      this.log.info('Anthropic provider initialized (API key)');
    }

    const openaiApiKey = this.secretsResolver?.get('providers.openai', 'apiKey')
      || cfg.openai?.apiKey || '';
    if (openaiApiKey) {
      this.providers.openai = new OpenAIProvider(
        { apiKey: openaiApiKey, defaultModel: cfg.openai?.defaultModel || 'gpt-4o' },
        this.config,
        this.log,
      );
      this.log.info('OpenAI provider initialized');
    }

    const ollamaBaseUrl = this.secretsResolver?.get('providers.ollama', 'baseUrl')
      || cfg.ollama?.baseUrl || '';
    if (ollamaBaseUrl) {
      this.providers.ollama = new OpenAIProvider(
        { apiKey: 'ollama', defaultModel: cfg.ollama?.defaultModel || 'llama3', baseUrl: ollamaBaseUrl + '/v1' },
        this.config,
        this.log,
      );
      this.log.info('Ollama provider initialized');
    }

    if (this.customProviderInit) {
      await this.customProviderInit(this);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initProviders();
    }
    await this.initPromise;
  }

  async hasProvider(providerPrefix: string): Promise<boolean> {
    await this.ensureInitialized();
    return !!this.providers[providerPrefix];
  }

  /** Synchronous check — only valid after ensureInitialized() has completed. */
  hasProviderSync(providerPrefix: string): boolean {
    return !!this.providers[providerPrefix];
  }

  private parseModelRef(modelRef?: string): { providerName: string; modelId: string } {
    const ref = modelRef || this.config.model.primary;
    const [providerName, ...modelParts] = ref.split('/');
    return { providerName, modelId: modelParts.join('/') };
  }

  async getProvider(modelRef?: string): Promise<{ provider: ProviderInterface; model: string }> {
    await this.ensureInitialized();

    const { providerName, modelId } = this.parseModelRef(modelRef);
    const provider = this.providers[providerName];

    if (!provider) {
      if (this.config.model.fallback) {
        const { providerName: fbName, modelId: fbModel } = this.parseModelRef(this.config.model.fallback);
        if (this.providers[fbName]) {
          this.log.warn({ wanted: providerName, using: fbName }, 'Primary provider unavailable, using fallback');
          return {
            provider: this.providers[fbName],
            model: fbModel || (this.providers[fbName] as ProviderInterface & { defaultModel?: string }).defaultModel || '',
          };
        }
      }
      throw new Error(`No provider available for "${providerName}". Configure an API key.`);
    }

    const model = modelId || (provider as ProviderInterface & { defaultModel?: string }).defaultModel || '';
    if (!model) {
      throw new Error(`No model ID resolved for "${modelRef}". Check model.primary in config.`);
    }

    return { provider, model };
  }

  async callWithFailover(chatArgs: ChatArgs): Promise<ProviderResponse> {
    await this.ensureInitialized();

    const { providerName, modelId } = this.parseModelRef(chatArgs.model);
    const primary = this.providers[providerName];
    if (!primary) {
      await this.getProvider(chatArgs.model);
      throw new Error('unreachable');
    }

    const model = modelId || (primary as ProviderInterface & { defaultModel?: string }).defaultModel || '';

    try {
      return await this.callWithRetry(primary, { ...chatArgs, model });
    } catch (primaryErr: unknown) {
      const primaryError = primaryErr as Error;
      this.log.warn({ provider: providerName, err: primaryError.message }, 'Primary provider failed');

      const chain = this.config.model.fallbackChain?.length
        ? this.config.model.fallbackChain
        : this.config.model.fallback ? [this.config.model.fallback] : [];

      for (const fbRef of chain) {
        if (!fbRef) continue;
        const { providerName: fbName, modelId: fbModel } = this.parseModelRef(fbRef);
        const fallback = this.providers[fbName];
        if (!fallback || fbName === providerName) continue;

        this.log.info({ from: providerName, to: fbName, attempt: chain.indexOf(fbRef) + 1 }, 'Failing over to next provider');
        this.failoverLog.push({ ts: new Date().toISOString(), from: providerName, to: fbName, error: primaryError.message });
        if (this.failoverLog.length > 50) {
          this.failoverLog = this.failoverLog.slice(-50);
        }

        try {
          return await this.callWithRetry(fallback, {
            ...chatArgs,
            model: fbModel || (fallback as ProviderInterface & { defaultModel?: string }).defaultModel || '',
          });
        } catch (fbErr: unknown) {
          this.log.warn({ provider: fbName, err: (fbErr as Error).message }, 'Fallback provider failed, trying next');
        }
      }

      throw primaryErr;
    }
  }

  private async callWithRetry(
    provider: ProviderInterface,
    chatArgs: ChatArgs,
    maxRetries = 3,
  ): Promise<ProviderResponse> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await provider.chat(chatArgs);
      } catch (e: unknown) {
        lastErr = e;
        const classified = classifyError(e, attempt);
        logClassifiedError(classified, { provider: provider.name, attempt, maxRetries });

        if (classified.retriable && attempt < maxRetries) {
          if (classified.action === 'compact_and_retry' || classified.action === 'failover') {
            throw e; // handled by outer callWithFailover or agent loop
          }
          if (classified.retryDelayMs > 0) {
            await new Promise((r) => setTimeout(r, classified.retryDelayMs));
          }
          continue;
        }

        throw e;
      }
    }
    throw lastErr;
  }

  async reinitProviders(): Promise<void> {
    this.providers = {};
    this.initPromise = null;
    await this.ensureInitialized();
    this.log.info({ providers: Object.keys(this.providers) }, 'Providers reinitialized');
  }

  async listProviders(): Promise<ProviderInfo[]> {
    await this.ensureInitialized();
    return Object.keys(this.providers).map((name) => ({ name }));
  }

  getFailoverLog(): FailoverEvent[] {
    return this.failoverLog;
  }
}
