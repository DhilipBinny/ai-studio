/**
 * MCP (Model Context Protocol) types.
 *
 * MCP allows the gateway to connect to external tool servers over
 * stdio or SSE transports, dynamically expanding the agent's capabilities.
 */

/** Supported MCP transport types. */
export type MCPTransportType = 'stdio' | 'sse';

/** MCP server connection status. */
export type MCPServerStatusValue =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'not_started'
  | 'disabled'
  | 'installing';

/**
 * Configuration for a single MCP server.
 *
 * Stored in `config.mcp.servers[id]`.
 */
export interface MCPServerConfig {
  /** Whether this server should be auto-connected on startup. */
  enabled: boolean;
  /** Transport protocol. */
  transport: MCPTransportType;
  /** Command to spawn (stdio transport). */
  command?: string;
  /** Arguments for the command (stdio transport). */
  args?: string[];
  /** Server URL (SSE transport). */
  url?: string;
  /** Environment variables to pass to the server process. */
  env?: Record<string, string>;
  /** HTTP headers for SSE connections. */
  headers?: Record<string, string>;
  /** Pinned content hash for integrity verification. */
  pinnedHash?: string;
}

/**
 * Runtime status of a connected MCP server.
 *
 * Returned by `MCPClient.status` and aggregated in `MCPBridge.getStatus()`.
 */
export interface MCPServerStatus {
  /** Server display name (matches the config key). */
  name: string;
  /** Current connection status. */
  status: MCPServerStatusValue;
  /** Error message if `status === 'error'`. */
  error: string | null;
  /** Human-readable status message (progress, tool count, etc). */
  statusMessage?: string | null;
  /** Server info returned during MCP initialize handshake. */
  serverInfo?: Record<string, unknown>;
  /** Number of tools provided by this server. */
  toolCount: number;
  /** List of tool names provided by this server. */
  tools: string[];
  /** Environment variable key names that are configured (values never exposed). */
  envKeys?: string[];
  /** Epoch timestamp when the connection was established. */
  connectedAt?: number | null;
  /** Transport type in use. */
  transport: MCPTransportType;
  /** Server configuration details (included in bridge status). */
  config?: {
    transport: MCPTransportType;
    command?: string;
    url?: string;
    enabled: boolean;
  };
}

/**
 * A tool definition from an MCP server.
 *
 * Discovered via the `tools/list` JSON-RPC call during connection.
 */
export interface MCPToolDefinition {
  /** Tool name as reported by the MCP server. */
  name: string;
  /** Human-readable tool description. */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** The MCP server this tool belongs to. */
  _mcpServer?: string;
}

/** Specification for an environment variable required by an MCP server. */
export interface MCPEnvVarSpec {
  /** Environment variable key. */
  key: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Whether this env var must be set for the server to work. */
  required: boolean;
  /** Whether the value is sensitive (token, password) — UI should mask input. */
  sensitive: boolean;
  /** Placeholder text for the input field. */
  placeholder?: string;
}

/**
 * Aggregated status of the MCP bridge.
 *
 * Returned by `MCPBridge.getStatus()`.
 */
export interface MCPBridgeStatus {
  /** Total number of configured servers. */
  totalServers: number;
  /** Number of successfully connected servers. */
  connectedServers: number;
  /** Total number of tools available across all connected servers. */
  totalTools: number;
  /** Per-server status keyed by server ID. */
  servers: Record<string, MCPServerStatus>;
}
