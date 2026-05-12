import type { AgwLogger } from '@ais/types';
import { noopLogger } from '@ais/types';

let _logger: AgwLogger = noopLogger;

export function setErrorsLogger(logger: AgwLogger): void {
  _logger = logger;
}

export type ErrorType =
  | 'rate_limit'
  | 'overloaded'
  | 'prompt_too_long'
  | 'auth_error'
  | 'timeout'
  | 'connection_error'
  | 'server_error'
  | 'invalid_request'
  | 'unknown'

export type RecoveryAction =
  | 'retry_with_backoff'
  | 'retry_immediately'
  | 'failover'
  | 'compact_and_retry'
  | 'reauth'
  | 'give_up'

export interface ClassifiedError {
  type: ErrorType;
  action: RecoveryAction;
  retriable: boolean;
  status?: number;
  message: string;
  retryDelayMs: number;
  userMessage?: string;
}

export function classifyError(error: unknown, attempt = 0): ClassifiedError {
  const err = error as Error & { status?: number; code?: string; headers?: Record<string, string> };
  const message = err?.message || String(error);
  const status = err?.status;

  if (status === 429 || /rate.limit|too many requests|429/i.test(message)) {
    const retryAfter = err?.headers?.['retry-after'];
    const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : getBackoffDelay(attempt);
    return { type: 'rate_limit', action: 'retry_with_backoff', retriable: true, status: 429, message, retryDelayMs: delay };
  }

  if (status === 529 || /overloaded|capacity|529/i.test(message)) {
    return { type: 'overloaded', action: 'retry_with_backoff', retriable: true, status: 529, message, retryDelayMs: getBackoffDelay(attempt, 2000) };
  }

  if (/prompt is too long|maximum context length|context.length|context.window|too.many.tokens|exceeds.*max.*token|max.*token.*exceeded/i.test(message)) {
    return { type: 'prompt_too_long', action: 'compact_and_retry', retriable: true, status, message, retryDelayMs: 0, userMessage: 'Your conversation is too long. Compacting context and retrying...' };
  }

  if (status === 401 || /unauthorized|invalid.*key|invalid.*token|auth.*error|invalid bearer/i.test(message)) {
    return { type: 'auth_error', action: 'give_up', retriable: false, status: 401, message, retryDelayMs: 0, userMessage: 'Authentication failed. Please check your API key or token configuration.' };
  }

  if (err?.name === 'AbortError' || /timed? ?out|timeout|ETIMEDOUT|aborted/i.test(message)) {
    return { type: 'timeout', action: 'failover', retriable: true, status, message, retryDelayMs: 0 };
  }

  if (/ECONNRESET|ECONNREFUSED|EPIPE|ENETUNREACH|ENOTFOUND|socket hang up|network/i.test(err?.code || message)) {
    const isStale = /ECONNRESET|EPIPE/i.test(err?.code || message);
    return { type: 'connection_error', action: isStale ? 'retry_immediately' : 'failover', retriable: true, status, message, retryDelayMs: isStale ? 0 : getBackoffDelay(attempt) };
  }

  if (status && status >= 500 && status < 600) {
    return { type: 'server_error', action: 'failover', retriable: true, status, message, retryDelayMs: getBackoffDelay(attempt) };
  }

  if (status === 400) {
    return { type: 'invalid_request', action: 'give_up', retriable: false, status: 400, message, retryDelayMs: 0, userMessage: 'The request was malformed. This may be a bug — please try again.' };
  }

  return { type: 'unknown', action: 'give_up', retriable: false, status, message, retryDelayMs: 0 };
}

export function getBackoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs * 0.5;
  return Math.min(exponential + jitter, maxMs);
}

export function logClassifiedError(classified: ClassifiedError, context?: Record<string, unknown>): void {
  const meta = {
    errorType: classified.type,
    action: classified.action,
    retriable: classified.retriable,
    status: classified.status,
    retryDelayMs: classified.retryDelayMs,
    ...context,
  };

  if (classified.retriable) {
    _logger.warn(meta, `LLM error [${classified.type}]: ${classified.message.slice(0, 200)}`);
  } else {
    _logger.error(meta, `LLM error [${classified.type}]: ${classified.message.slice(0, 200)}`);
  }
}
