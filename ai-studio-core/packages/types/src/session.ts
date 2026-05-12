/**
 * Session management types.
 *
 * Sessions track conversation state, token usage, and history across
 * channels. Each session is identified by a composite key derived from
 * the channel and chat context.
 */

/**
 * Session key — a composite string that uniquely identifies a conversation context.
 *
 * Format: `"main"` for DMs, `"{channel}:group:{chatId}"` for group chats.
 */
export type SessionKey = string;

/**
 * A single user/agent session.
 *
 * Created by `SessionManager.getOrCreate()` and persisted to
 * `~/.agw/sessions/store.json`.
 */
export interface Session {
  /** Unique session identifier (UUID v4). */
  sessionId: string;
  /** Composite session key (e.g. `"main"`, `"telegram:group:12345"`). */
  key: SessionKey;
  /** ISO 8601 timestamp of session creation. */
  createdAt: string;
  /** ISO 8601 timestamp of last activity. */
  updatedAt: string;
  /** Cumulative input tokens consumed in this session. */
  inputTokens: number;
  /** Cumulative output tokens consumed in this session. */
  outputTokens: number;
  /** Number of user turns (request-response cycles). */
  turns: number;
  /** Last channel that interacted with this session. */
  lastChannel: string | null;
  /** Last chat ID that interacted with this session. */
  lastChatId: string | number | null;
}

/**
 * The full session store — a map of session keys to session objects.
 *
 * Serialised as JSON to `~/.agw/sessions/store.json`.
 */
export type SessionStore = Record<SessionKey, Session>;
