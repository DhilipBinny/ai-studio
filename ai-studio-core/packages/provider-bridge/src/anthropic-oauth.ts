/**
 * Anthropic OAuth Provider — proprietary subscription-based auth.
 *
 * Uses the Anthropic SDK with OAuth bearer token authentication.
 * This enables Claude Pro/Max subscription usage without API key billing.
 *
 * Uses the exact same SDK approach as the main KairoClaw Anthropic provider
 * to ensure identical behavior, rate limiting, and compatibility.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatArgs,
  EnterpriseProvider,
  Message,
  MessageContentPart,
  ProviderResponse,
  StructuredSystemPrompt,
  TestResult,
  ThinkingBlock,
  ThinkingConfig,
  ToolCall,
  ToolDefinition,
} from './types';

/** Streaming timeout: max wait for first chunk (ms). */
const TTFT_TIMEOUT_MS = 60_000;
/** Streaming timeout: max silence between chunks (ms). */
const IDLE_TIMEOUT_MS = 120_000;
/** Test request timeout (ms). */
const TEST_TIMEOUT_MS = 15_000;

/** Default model. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Beta flags — must match main branch for identical behavior. */
const BETA_FLAGS = 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14';

/** Model info returned by listModels. */
export interface ModelInfo {
  id: string;
  displayName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: Record<string, unknown>;
}

/** Validate auth token — reject tokens with CRLF (header injection defense). */
function validateAuthToken(token: string): void {
  if (/[\r\n]/.test(token)) {
    throw new Error('Auth token contains invalid characters');
  }
}

/** Create an Anthropic SDK client configured for OAuth. */
function createClient(authToken: string): Anthropic {
  return new Anthropic({
    apiKey: '',
    authToken,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      'accept': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': BETA_FLAGS,
      'user-agent': 'claude-cli/0.1 (external, cli)',
      'x-app': 'cli',
    },
  } as Record<string, unknown>);
}

/** Extract text from message content (string or array of content parts). */
function extractTextContent(content: string | MessageContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

/**
 * Convert KairoClaw messages to Anthropic SDK format.
 */
function convertMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'system':
        continue;

      case 'user': {
        if (pendingToolResults.length > 0) {
          result.push({ role: 'user', content: pendingToolResults });
          pendingToolResults = [];
        }
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else {
          const blocks: Anthropic.ContentBlockParam[] = msg.content.map(part => {
            if (part.type === 'text') return { type: 'text' as const, text: part.text };
            if (part.type === 'image') return {
              type: 'image' as const,
              source: part.source as Anthropic.Base64ImageSource,
            };
            return { type: 'text' as const, text: '' };
          });
          result.push({ role: 'user', content: blocks });
        }
        break;
      }

      case 'assistant': {
        if (pendingToolResults.length > 0) {
          result.push({ role: 'user', content: pendingToolResults });
          pendingToolResults = [];
        }

        const contentBlocks: Anthropic.ContentBlockParam[] = [];

        if (msg.thinking_blocks) {
          for (const tb of msg.thinking_blocks) {
            contentBlocks.push({
              type: 'thinking' as const,
              thinking: tb.thinking,
              signature: tb.signature,
            } as unknown as Anthropic.ContentBlockParam);
          }
        }

        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text) {
          contentBlocks.push({ type: 'text' as const, text });
        }

        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            let input: Record<string, unknown>;
            try {
              input = JSON.parse(tc.function.arguments);
            } catch {
              input = {};
            }
            contentBlocks.push({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.function.name,
              input,
            });
          }
        }

        if (contentBlocks.length === 0) {
          contentBlocks.push({ type: 'text' as const, text: '' });
        }

        result.push({ role: 'assistant', content: contentBlocks });
        break;
      }

      case 'tool': {
        const content = extractTextContent(msg.content);
        pendingToolResults.push({
          type: 'tool_result' as const,
          tool_use_id: msg.tool_call_id || '',
          content,
        });
        break;
      }

      default: {
        const content = typeof msg.content === 'string' ? msg.content : '';
        result.push({ role: 'user', content });
      }
    }
  }

  if (pendingToolResults.length > 0) {
    result.push({ role: 'user', content: pendingToolResults });
  }

  return result;
}

/** Convert KairoClaw tool definitions to Anthropic SDK format. */
function convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: (t.parameters || { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
  }));
}

/** Build system prompt blocks for Anthropic OAuth mode. */
function buildSystemBlocks(sp: string | StructuredSystemPrompt): Anthropic.TextBlockParam[] {
  // Prepend Claude Code identity — required for OAuth token auth
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
  ];
  if (typeof sp === 'string') {
    if (sp) blocks.push({ type: 'text', text: sp, cache_control: { type: 'ephemeral' } });
  } else {
    if (sp.cached) {
      blocks.push({ type: 'text', text: sp.cached, cache_control: { type: 'ephemeral' } });
    }
    if (sp.dynamic) {
      blocks.push({ type: 'text', text: sp.dynamic });
    }
  }
  return blocks;
}

/**
 * OAuth Provider — uses Anthropic SDK with OAuth bearer token.
 * Identical SDK configuration to the main KairoClaw Anthropic provider.
 */
export class OAuthProvider implements EnterpriseProvider {
  name = 'kairo-premium';
  private client: Anthropic;
  private defaultModel: string;

  constructor(authToken: string, defaultModel = DEFAULT_MODEL) {
    validateAuthToken(authToken);
    this.client = createClient(authToken);
    this.defaultModel = defaultModel;
  }

  async chat(args: ChatArgs): Promise<ProviderResponse> {
    const model = args.model || this.defaultModel;
    const messages = convertMessages(args.messages);
    const system = buildSystemBlocks(args.systemPrompt);

    // Match deployed max_tokens: 8192 for most models, 16384 for Opus
    const maxOutputTokens = model.includes('opus') ? 16384 : 8192;

    const params: Record<string, unknown> = {
      model,
      max_tokens: maxOutputTokens,
      messages,
      system,
      stream: true,
    };

    if (args.tools && args.tools.length > 0) {
      params.tools = convertTools(args.tools);
    }

    if (args.thinkingConfig?.enabled) {
      params.thinking = {
        type: 'enabled',
        budget_tokens: args.thinkingConfig.budgetTokens || 10000,
      };
      params.max_tokens = Math.max(maxOutputTokens, (args.thinkingConfig.budgetTokens || 10000) + maxOutputTokens);
      // Thinking + tools requires tool_choice "auto"
      if (params.tools) {
        params.tool_choice = { type: 'auto' };
      }
    }

    // Streaming timeout: TTFT (60s) + idle (120s) — replaces single wall-clock timeout
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => abortController.abort(), TTFT_TIMEOUT_MS);
    if (args.signal) {
      args.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }
    const resetIdleTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => abortController.abort(), IDLE_TIMEOUT_MS);
    };
    const effectiveSignal = abortController.signal;

    try {
      const stream = this.client.messages.stream(params as unknown as Anthropic.MessageStreamParams, {
        signal: effectiveSignal,
      });

      let fullText = '';
      let thinkingText = '';
      const toolCalls: (ToolCall & { _rawArgs?: string })[] = [];
      const thinkingBlocks: ThinkingBlock[] = [];
      let currentThinkingBlock: { thinking: string; signature: string } | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason = '';

      for await (const event of stream) {
        resetIdleTimer();
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            toolCalls.push({
              id: event.content_block.id,
              function: { name: event.content_block.name, arguments: '' },
              _rawArgs: '',
            });
          } else if ((event.content_block as any).type === 'thinking') {
            currentThinkingBlock = { thinking: '', signature: '' };
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta as any;
          if (delta.type === 'text_delta') {
            fullText += delta.text;
            args.onDelta?.(delta.text);
          } else if (delta.type === 'input_json_delta') {
            const tc = toolCalls[toolCalls.length - 1];
            if (tc) tc._rawArgs = (tc._rawArgs || '') + delta.partial_json;
          } else if (delta.type === 'thinking_delta') {
            const chunk = delta.thinking as string;
            thinkingText += chunk;
            if (currentThinkingBlock) currentThinkingBlock.thinking += chunk;
            args.onThinkingDelta?.(chunk);
          } else if (delta.type === 'signature_delta') {
            if (currentThinkingBlock) currentThinkingBlock.signature += delta.signature as string;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentThinkingBlock) {
            thinkingBlocks.push({
              type: 'thinking',
              thinking: currentThinkingBlock.thinking,
              signature: currentThinkingBlock.signature,
            });
            currentThinkingBlock = null;
          }
        } else if (event.type === 'message_delta') {
          if ((event as any).usage) {
            outputTokens = (event as any).usage.output_tokens || 0;
          }
          const deltaStopReason = (event as any).delta?.stop_reason as string | undefined;
          if (deltaStopReason) stopReason = deltaStopReason;
        } else if (event.type === 'message_start') {
          if ((event as any).message?.usage) {
            inputTokens = (event as any).message.usage.input_tokens || 0;
          }
        }
      }

      // Finalize tool call arguments
      for (const tc of toolCalls) {
        tc.function.arguments = tc._rawArgs || '{}';
        delete tc._rawArgs;
      }

      return {
        text: fullText || null,
        toolCalls: toolCalls.length > 0 ? toolCalls : null,
        usage: { inputTokens, outputTokens },
        thinkingText: thinkingText || null,
        thinkingBlocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
        stopReason: stopReason || undefined,
      };
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err.name === 'AbortError') throw new Error('Request timed out');

      // Provide helpful error messages for auth issues (matching deployed behavior)
      if (err.status === 401) {
        throw new Error(
          'Anthropic 401: OAuth token may be expired or invalid. ' +
          'Re-run `claude setup-token` and update the auth token.',
        );
      }

      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Test OAuth connection using the SDK. */
export async function testOAuthConnection(authToken: string): Promise<TestResult> {
  if (!authToken) {
    return { success: false, error: 'No auth token provided' };
  }

  try {
    validateAuthToken(authToken);
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  const client = createClient(authToken);
  const start = Date.now();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TEST_TIMEOUT_MS);

  try {
    // Use the models list endpoint to verify auth — no chat call, no model dependency
    const models = await client.models.list();
    const latencyMs = Date.now() - start;
    const firstModel = models.data?.[0];
    return {
      success: true,
      model: (firstModel as unknown as Record<string, unknown>)?.id as string || 'connected',
      latencyMs,
    };
  } catch (e: unknown) {
    const latencyMs = Date.now() - start;
    const err = e as { status?: number; message?: string };

    if (err.status === 429) {
      return {
        success: true,
        latencyMs,
        note: 'Rate limited — auth is valid but subscription quota exceeded',
      };
    }
    if (err.status === 400) {
      return { success: true, latencyMs };
    }
    if (err.status === 401) {
      return { success: false, error: 'Invalid or expired OAuth token (401)' };
    }
    if (err.status === 403) {
      return { success: false, error: 'Access denied (403) — token may not have API access' };
    }
    if ((e as Error).name === 'AbortError') {
      return { success: false, error: 'Connection timed out' };
    }
    return { success: false, error: `Connection failed: ${err.message || String(e)}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Fetch available models from the Anthropic API. */
export async function listModels(authToken: string): Promise<ModelInfo[]> {
  validateAuthToken(authToken);
  const client = createClient(authToken);

  try {
    const response = await client.models.list();
    return response.data.map((m) => {
      const raw = m as unknown as Record<string, unknown>;
      return {
        id: raw.id as string,
        displayName: (raw.display_name as string) || (raw.id as string),
        maxInputTokens: (raw.max_input_tokens as number) || 0,
        maxOutputTokens: (raw.max_tokens as number) || 0,
        capabilities: (raw.capabilities as Record<string, unknown>) || {},
      };
    });
  } catch {
    return [];
  }
}
