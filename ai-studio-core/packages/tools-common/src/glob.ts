import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { resolveTenantPath, getAgentWorkspacePath } from "./workspace";
import type { BuiltinToolContext } from "./types";

const execFile = promisify(execFileCb);

const DEFAULT_HEAD_LIMIT = 200;
const EXEC_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

export const globTools: ToolRegistration[] = [
  {
    definition: {
      name: "glob",
      alwaysLoad: true,
      description:
        "List files matching a glob pattern in the agent workspace, sorted by modification time (newest first). " +
        'Respects .gitignore. Examples: "**/*.ts", "src/**/*.{js,tsx}", "*.md".',
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.{js,tsx}").',
          },
          path: {
            type: "string",
            description: "Directory to search from. Defaults to workspace root.",
          },
          head_limit: {
            type: "number",
            description: "Max file paths to return (default 200).",
          },
        },
        required: ["pattern"],
      },
    },
    executor: async (args, context) => {
      const pattern = args.pattern as string;
      if (!pattern || typeof pattern !== "string") {
        return { error: "pattern is required and must be a string" };
      }

      const ctx = getCtx(context as Record<string, unknown>);
      const workspace = getAgentWorkspacePath(ctx.workspace);

      let searchPath: string;
      try {
        searchPath = args.path
          ? resolveTenantPath(args.path as string, ctx.workspace)
          : workspace;
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }

      const rgArgs = [
        "--files",
        "--sort", "modified",
        "-g", pattern,
        searchPath,
      ];

      let stdout = "";
      try {
        const result = await execFile("rg", rgArgs, {
          maxBuffer: MAX_OUTPUT_BYTES,
          timeout: EXEC_TIMEOUT_MS,
        });
        stdout = result.stdout;
      } catch (e: unknown) {
        const err = e as { stdout?: string; code?: number | string; message?: string };
        if (err.code === 1) {
          return textEnvelope(`No files match pattern: ${pattern}`);
        }
        if (err.code === 2 || typeof err.code === "string") {
          return { error: `ripgrep error: ${err.message || "unknown"}` };
        }
        stdout = err.stdout || "";
      }

      const files = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((f) => path.relative(workspace, f) || f);

      const headLimit = typeof args.head_limit === "number" && args.head_limit > 0
        ? args.head_limit
        : DEFAULT_HEAD_LIMIT;
      const total = files.length;
      const shown = files.slice(0, headLimit);
      const truncated = total > shown.length;

      const header = `glob ${pattern}  ${total} match${total === 1 ? "" : "es"}${truncated ? `  (showing ${shown.length})` : ""}`;
      const body = shown.join("\n");
      const footer = truncated ? `\n\n[${total - shown.length} more — bump head_limit to see more]` : "";

      return textEnvelope(`${header}\n\n${body}${footer}`);
    },
    source: "builtin",
    category: "read",
    concurrencySafe: true,
    isReadOnly: true,
  },
];
