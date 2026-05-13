import fs from "node:fs";
import path from "node:path";
import type { WorkspaceConfig } from "./types";

export function getAgentWorkspacePath(config: WorkspaceConfig): string {
  return path.resolve(config.dataRoot, "tenants", config.tenantId, "workspace", config.agentId);
}

export function getSharedWorkspacePath(config: WorkspaceConfig): string {
  return path.resolve(config.dataRoot, "tenants", config.tenantId, "workspace", "shared");
}

export function getTempPath(config: WorkspaceConfig): string {
  return path.resolve(config.dataRoot, "tenants", config.tenantId, "temp", config.sessionId);
}

export function ensureWorkspace(config: WorkspaceConfig): string {
  const agentDir = getAgentWorkspacePath(config);
  fs.mkdirSync(agentDir, { recursive: true });
  const sharedDir = getSharedWorkspacePath(config);
  fs.mkdirSync(sharedDir, { recursive: true });
  return agentDir;
}

export function resolveTenantPath(requestedPath: string, config: WorkspaceConfig): string {
  const agentBase = getAgentWorkspacePath(config);
  const sharedBase = getSharedWorkspacePath(config);

  if (!requestedPath) return agentBase;

  if (requestedPath.includes("\0")) {
    throw new Error("Path traversal blocked: null bytes not allowed");
  }
  if (/[\x00-\x1f\x7f]/.test(requestedPath)) {
    throw new Error("Path traversal blocked: control characters not allowed");
  }

  let resolved: string;

  if (path.isAbsolute(requestedPath)) {
    throw new Error(`Access denied: absolute paths not allowed ("${requestedPath}")`);
  }

  if (requestedPath.startsWith("shared/") || requestedPath === "shared") {
    const relative = requestedPath.slice("shared".length).replace(/^\//, "");
    resolved = relative ? path.resolve(sharedBase, relative) : sharedBase;
  } else {
    resolved = path.resolve(agentBase, requestedPath);
  }

  const isInAgent = resolved === agentBase || resolved.startsWith(agentBase + path.sep);
  const isInShared = resolved === sharedBase || resolved.startsWith(sharedBase + path.sep);

  if (!isInAgent && !isInShared) {
    throw new Error(`Access denied: path "${requestedPath}" resolves outside workspace`);
  }

  try {
    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      const realInAgent = realPath === agentBase || realPath.startsWith(agentBase + path.sep);
      const realInShared = realPath === sharedBase || realPath.startsWith(sharedBase + path.sep);
      if (!realInAgent && !realInShared) {
        throw new Error(`Access denied: symlink "${requestedPath}" resolves outside workspace`);
      }
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  return resolved;
}
