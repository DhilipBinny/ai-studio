/**
 * Channel types.
 *
 * Channels are the entry points through which users interact with the
 * gateway — web UI, Telegram bot, Slack, or the REST API.
 */

/** Supported channel identifiers. */
export type ChannelType = 'web' | 'telegram' | 'slack' | 'api';

/**
 * Interface for a channel handler.
 *
 * Each channel (web, telegram, etc.) implements this interface to
 * handle lifecycle and optional broadcast capabilities.
 */
export interface ChannelHandler {
  /** Start listening for inbound messages on this channel. */
  start(): Promise<void> | void;
  /** Gracefully stop the channel. */
  stop(): Promise<void> | void;
  /** Broadcast a message to all connected clients on this channel. */
  broadcast?(data: Record<string, unknown>): void;
}
