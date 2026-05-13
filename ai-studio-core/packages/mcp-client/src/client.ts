import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig, MCPServerStatus, MCPServerStatusValue, MCPToolDefinition } from "@ais/types";

const SAFE_ENV_KEYS = [
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE",
  "NODE_ENV", "TZ", "TMPDIR", "COLORTERM",
];

export const ALLOWED_COMMANDS = new Set([
  "npx", "node", "python", "python3", "uvx", "docker", "deno", "bun",
]);

function buildSafeEnv(configEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  if (configEnv) {
    for (const [k, v] of Object.entries(configEnv)) {
      env[k] = v;
    }
  }
  return env;
}

function validateCommand(command: string): void {
  const base = command.includes("/") ? command.split("/").pop()! : command;
  if (!ALLOWED_COMMANDS.has(base)) {
    throw new Error(
      `Command "${base}" is not in the allowed list. ` +
      `Permitted: ${[...ALLOWED_COMMANDS].join(", ")}. ` +
      `Use npx or docker to run MCP servers.`
    );
  }
}

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private serverName: string;
  private config: MCPServerConfig;
  private tools: MCPToolDefinition[] = [];
  private statusValue: MCPServerStatusValue = "disconnected";
  private error: string | null = null;
  private connectedAt: number | null = null;

  constructor(serverName: string, config: MCPServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client) await this.disconnect();

    this.statusValue = "connecting";
    this.error = null;

    try {
      if (this.config.transport === "stdio") {
        if (!this.config.command) throw new Error("Command is required for stdio transport");
        validateCommand(this.config.command);

        this.transport = new StdioClientTransport({
          command: this.config.command,
          args: this.config.args || [],
          env: buildSafeEnv(this.config.env as Record<string, string> | undefined),
        });
      } else {
        throw new Error(`Transport "${this.config.transport}" is not yet supported. Use stdio.`);
      }

      this.client = new Client(
        { name: "echol-ai-studio", version: "1.0.0" },
        { capabilities: {} },
      );

      await this.client.connect(this.transport);

      const result = await this.client.listTools();
      this.tools = (result.tools || []).map((t) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema as MCPToolDefinition["inputSchema"],
        _mcpServer: this.serverName,
      }));

      this.statusValue = "connected";
      this.connectedAt = Date.now();
    } catch (e) {
      this.statusValue = "error";
      this.error = (e as Error).message;
      this.tools = [];
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } catch {
      // ignore cleanup errors
    }
    this.client = null;
    this.transport = null;
    this.statusValue = "disconnected";
    this.connectedAt = null;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client || this.statusValue !== "connected") {
      throw new Error(`MCP server "${this.serverName}" is not connected`);
    }

    const result = await this.client.callTool({ name, arguments: args });

    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((c) => {
          if (typeof c === "object" && c !== null && "text" in c) return (c as { text: string }).text;
          return JSON.stringify(c);
        })
        .join("\n");
    }

    return JSON.stringify(result);
  }

  listTools(): MCPToolDefinition[] {
    return this.tools;
  }

  getStatus(): MCPServerStatus {
    return {
      name: this.serverName,
      status: this.statusValue,
      error: this.error,
      toolCount: this.tools.length,
      tools: this.tools.map((t) => t.name),
      connectedAt: this.connectedAt,
      transport: this.config.transport,
      config: {
        transport: this.config.transport,
        command: this.config.command,
        url: this.config.url,
        enabled: this.config.enabled,
      },
    };
  }

  isConnected(): boolean {
    return this.statusValue === "connected";
  }
}
