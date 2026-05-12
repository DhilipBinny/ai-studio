/**
 * Message and conversation types.
 *
 * These types describe the messages flowing through the agent loop:
 * inbound user messages, conversation history entries, tool calls,
 * and transcript records.
 */

/** Allowed message roles in the conversation. */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * A thinking block from extended thinking / chain-of-thought.
 * Contains the model's reasoning and a cryptographic signature
 * required by Anthropic for multi-turn continuity.
 */
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

/**
 * A tool call embedded in an assistant message.
 *
 * Follows the OpenAI-style format used internally, with a nested `function`
 * object containing the tool name and JSON-encoded arguments.
 */
export interface ToolCall {
  /** Unique tool call identifier. */
  id: string;
  /** Tool function details. */
  function: {
    /** Name of the tool to invoke. */
    name: string;
    /** JSON-encoded arguments string. */
    arguments: string;
  };
}

/**
 * A message in the conversation history.
 *
 * This is the internal format passed to providers. Tool results use
 * `role: 'tool'` with a `tool_call_id`; assistant messages that invoke
 * tools carry a `tool_calls` array.
 */
/** A content block in a multimodal message. */
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface Message {
  /** The speaker role. */
  role: MessageRole;
  /** Text content of the message, or array of content parts for multimodal messages. */
  content: string | MessageContentPart[];
  /** Tool calls requested by the assistant (present when `role === 'assistant'`). */
  tool_calls?: ToolCall[];
  /** ID of the tool call this message is responding to (present when `role === 'tool'`). */
  tool_call_id?: string;
  /** Thinking blocks from extended thinking (present when `role === 'assistant'`). */
  thinking_blocks?: ThinkingBlock[];
}

/**
 * An inbound message arriving from any channel (web, Telegram, API, cron).
 *
 * This is the entry point to the agent loop — `runAgent(inbound, callbacks)`.
 */
export interface InboundMessage {
  /** The user's text input. */
  text: string;
  /** Source channel identifier. */
  channel: string;
  /** Chat ID within the channel (e.g. Telegram chat ID). */
  chatId: string | number;
  /** Chat type — used to derive the session key. */
  chatType?: 'private' | 'group';
  /** Numeric or string user ID. */
  userId?: string | number;
  /** Display name of the sender. */
  senderName?: string;
  /** Attached images with base64 data and metadata. */
  images?: Array<{
    data: string;       // base64 encoded
    mimeType: string;   // image/jpeg, image/png, etc.
    filename?: string;  // original filename
  }>;
}

/**
 * A single entry in a session transcript (JSONL file).
 *
 * Persisted to `~/.agw/sessions/{sessionId}.jsonl`.
 */
export interface TranscriptEntry {
  /** Message role. */
  role: MessageRole;
  /** Message content. */
  content: string;
  /** ISO 8601 timestamp. */
  ts: string;
  /** Source channel (present on user messages). */
  channel?: string;
  /** Sender display name (present on user messages). */
  sender?: string;
  /** Tool calls (present on assistant messages that invoked tools). */
  tool_calls?: ToolCall[];
  /** Tool call ID (present on tool result messages). */
  tool_call_id?: string;
}

/**
 * A media attachment produced by a tool (via the `_media` convention).
 * Collected by the agent loop into `AgentResult.media[]`.
 */
export interface MediaAttachment {
  type: 'image' | 'document' | 'audio' | 'video' | 'voice';
  /** Absolute path to the file on disk. */
  filePath: string;
  /** Display name (e.g. "photo.png"). */
  fileName: string;
  /** MIME type. */
  mimeType: string;
  /** Optional caption. */
  caption?: string;
  /** Media store URL (e.g. /api/v1/media/uuid.ext). */
  url?: string;
}

/**
 * Callbacks provided to the agent loop for streaming and tool progress.
 */
export interface AgentCallbacks {
  /** Called with each text delta as the LLM streams its response. */
  onDelta?: (delta: string) => void;
  /** Called with each thinking delta during extended thinking. */
  onThinkingDelta?: (delta: string) => void;
  /** Called when a tool execution begins. */
  onToolStart?: (toolName: string, args: Record<string, unknown>) => void;
  /** Called when a tool execution completes. */
  onToolEnd?: (toolName: string, resultPreview: string) => void;
  /** Called when a tool produces a media attachment. */
  onMedia?: (item: MediaAttachment) => void;
}

/**
 * The result returned by `runAgent()`.
 */
export interface AgentResult {
  /** Final assistant text. `null` if the agent chose NO_REPLY. */
  text: string | null;
  /** Accumulated thinking text from the final LLM round, if extended thinking was enabled. */
  thinkingText?: string | null;
  /** Token usage for this turn. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** `true` if the response came from a slash command. */
  slashResult?: boolean;
  /** `true` if an error occurred. */
  error?: boolean;
  /** Media attachments collected from tool results (via `_media` convention). */
  media?: MediaAttachment[];
  /** Model ID used for this turn (for model indicator feature). */
  model?: string;
  /** Role of the user who triggered this turn (for role-based model indicator visibility). */
  userRole?: string;
}
