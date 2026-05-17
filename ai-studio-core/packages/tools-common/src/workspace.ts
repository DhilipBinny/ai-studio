import fs from "node:fs";
import path from "node:path";
import type { WorkspaceConfig } from "./types";

export function getProjectWorkspacePath(config: WorkspaceConfig): string | null {
  if (!config.projectId) return null;
  if (config.projectPath) return config.projectPath;
  return path.resolve(config.dataRoot, "tenants", config.tenantId, "projects", config.projectId);
}

export function getAgentWorkspacePath(config: WorkspaceConfig): string {
  const projectPath = getProjectWorkspacePath(config);
  if (projectPath) return projectPath;
  if (config.workflowRunId) {
    return path.resolve(config.dataRoot, "tenants", config.tenantId, "workspace", "runs", config.workflowRunId);
  }
  const newPath = path.resolve(config.dataRoot, "tenants", config.tenantId, "workspace", "agents", config.agentId);
  const legacyPath = path.resolve(config.dataRoot, "tenants", config.tenantId, "workspace", config.agentId);
  if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  return newPath;
}

export function getSharedWorkspacePath(config: WorkspaceConfig): string {
  return path.resolve(config.dataRoot, "tenants", config.tenantId, "workspace", "shared");
}

export function getTempPath(config: WorkspaceConfig): string {
  return path.resolve(config.dataRoot, "tenants", config.tenantId, "temp", config.sessionId);
}

export function ensureWorkspace(config: WorkspaceConfig): string {
  const wsDir = getAgentWorkspacePath(config);
  fs.mkdirSync(wsDir, { recursive: true });
  const sharedDir = getSharedWorkspacePath(config);
  fs.mkdirSync(sharedDir, { recursive: true });
  return wsDir;
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

  if (path.isAbsolute(requestedPath)) {
    throw new Error(`Access denied: absolute paths not allowed ("${requestedPath}")`);
  }

  let resolved: string;

  if (requestedPath.startsWith("shared/") || requestedPath === "shared") {
    const relative = requestedPath.slice("shared".length).replace(/^\//, "");
    resolved = relative ? path.resolve(sharedBase, relative) : sharedBase;
  } else {
    resolved = path.resolve(agentBase, requestedPath);
  }

  const isInWorkspace = resolved === agentBase || resolved.startsWith(agentBase + path.sep);
  const isInShared = resolved === sharedBase || resolved.startsWith(sharedBase + path.sep);

  if (!isInWorkspace && !isInShared) {
    throw new Error(`Access denied: path "${requestedPath}" resolves outside workspace`);
  }

  try {
    if (fs.existsSync(resolved)) {
      const lstat = fs.lstatSync(resolved);
      if (lstat.isSymbolicLink()) {
        const realPath = fs.realpathSync(resolved);
        const realInWorkspace = realPath === agentBase || realPath.startsWith(agentBase + path.sep);
        const realInShared = realPath === sharedBase || realPath.startsWith(sharedBase + path.sep);
        if (!realInWorkspace && !realInShared) {
          throw new Error(`Access denied: symlink "${requestedPath}" resolves outside workspace`);
        }
      }
    }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }

  return resolved;
}
