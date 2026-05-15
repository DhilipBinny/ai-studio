export { ProviderRegistry, type SecretsResolver, type ProviderInfo } from './registry';
export { AnthropicProvider, type AnthropicProviderConfig } from './anthropic';
export { OpenAIProvider } from './openai';
export { createStreamingTimeout, type StreamingTimeout, type StreamingTimeoutOptions } from './streaming-timeout';
export {
  classifyError, logClassifiedError, getBackoffDelay, setErrorsLogger,
  type ErrorType, type RecoveryAction, type ClassifiedError,
} from './errors';
export type { ProviderOptions } from './types';
export type { ProviderInterface, ProviderResponse, ChatArgs } from './types';
export {
  MODEL_DEFAULTS, getModelCapabilities, estimateCost, stripProviderPrefix,
  parseAnthropicModels, parseOllamaModel, mergeCapabilities,
} from './models';
// test-connection.ts removed — canonical implementation is in
// ai-studio-app/web/src/lib/services/provider-test.ts (includes SSRF, decryption, timeouts)
export type { TestResult, DiscoveredModel, ProviderTestConfig } from './test-connection';
export {
  embedText, embedSingle,
  type EmbeddingConfig,
} from './embedding';
export {
  rerankText,
  type RerankConfig, type RerankResult,
} from './reranker';
