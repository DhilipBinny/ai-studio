import { MCPClient } from "./client";
import type { MCPServerConfig, MCPBridgeStatus, MCPServerStatus, MCPToolDefinition } from "@ais/types";

export class MCPBridge {
  private clients = new Map<string, MCPClient>();

  async connectServer(id: string, config: MCPServerConfig): Promise<MCPServerStatus> {
    if (this.clients.has(id)) {
      const existing = this.clients.get(id)!;
      if (existing.isConnected()) return existing.getStatus();
      await existing.disconnect();
    }

    const client = new MCPClient(id, config);
    await client.connect();
    this.clients.set(id, client);
    return client.getStatus();
  }

  async disconnectServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [id, client] of this.clients) {
      await client.disconnect();
    }
    this.clients.clear();
  }

  getTools(serverIds?: string[]): MCPToolDefinition[] {
    const tools: MCPToolDefinition[] = [];
    for (const [id, client] of this.clients) {
      if (serverIds && !serverIds.includes(id)) continue;
      if (client.isConnected()) {
        tools.push(...client.listTools());
      }
    }
    return tools;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP server "${serverId}" not found`);
    if (!client.isConnected()) throw new Error(`MCP server "${serverId}" is not connected`);
    return client.callTool(toolName, args);
  }

  getStatus(): MCPBridgeStatus {
    const servers: Record<string, MCPServerStatus> = {};
    let connectedCount = 0;
    let totalTools = 0;

    for (const [id, client] of this.clients) {
      const status = client.getStatus();
      servers[id] = status;
      if (client.isConnected()) {
        connectedCount++;
        totalTools += status.toolCount;
      }
    }

    return {
      totalServers: this.clients.size,
      connectedServers: connectedCount,
      totalTools,
      servers,
    };
  }

  isServerConnected(id: string): boolean {
    return this.clients.get(id)?.isConnected() || false;
  }
}
