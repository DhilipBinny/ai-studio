import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { resolveTenantPath, getAgentWorkspacePath } from "./workspace";
import type { BuiltinToolContext } from "./types";

const execFile = promisify(execFileCb);

const DEFAULT_HEAD_LIMIT = 250;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 30_000;

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

export const grepTools: ToolRegistration[] = [
  {
    definition: {
      name: "grep",
      alwaysLoad: true,
      description:
        "Search file contents with ripgrep in the agent workspace. Fast, regex-capable, respects .gitignore. " +
        'Output modes: "files_with_matches" (default, just paths), "content" (matching lines), "count" (per-file counts).',
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for (ripgrep syntax).",
          },
          path: {
            type: "string",
            description: "File or directory to search. Defaults to workspace root.",
          },
          glob: {
            type: "string",
            description: 'Glob to filter filenames (e.g. "*.ts", "**/*.{js,tsx}").',
          },
          type: {
            type: "string",
            description: 'Ripgrep file type (e.g. "js", "py", "rust").',
          },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
            description: "content = matching lines; files_with_matches = file paths only (default); count = match counts",
          },
          case_insensitive: { type: "boolean", description: "Case-insensitive match" },
          context_lines: { type: "number", description: "Lines of context before and after each match (content mode)" },
          head_limit: {
            type: "number",
            description: "Max output lines (default 250).",
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

      const rgArgs: string[] = [];
      const outputMode = (args.output_mode as string) || "files_with_matches";

      if (outputMode === "files_with_matches") {
        rgArgs.push("--files-with-matches");
      } else if (outputMode === "count") {
        rgArgs.push("--count-matches");
      }

      if (args.case_insensitive === true) rgArgs.push("-i");
      if (outputMode === "content") {
        rgArgs.push("-n");
        if (typeof args.context_lines === "number") rgArgs.push("-C", String(args.context_lines));
      }

      if (typeof args.glob === "string" && args.glob.length > 0) {
        rgArgs.push("-g", args.glob);
      }
      if (typeof args.type === "string" && args.type.length > 0) {
        rgArgs.push("-t", args.type);
      }

      rgArgs.push("--color", "never", "--no-heading");
      rgArgs.push("--", pattern, searchPath);

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
          return textEnvelope(`No matches found for pattern: ${pattern}`);
        }
        if (err.code === 2 || typeof err.code === "string") {
          return { error: `ripgrep error: ${err.message || "unknown"}` };
        }
        stdout = err.stdout || "";
      }

      const headLimit = typeof args.head_limit === "number" && args.head_limit > 0
        ? args.head_limit
        : DEFAULT_HEAD_LIMIT;

      const allLines = stdout.split("\n").filter((l) => l.length > 0)
        .map((line) => line.startsWith(workspace) ? line.slice(workspace.length + 1) : line);
      const totalMatches = allLines.length;
      const paged = allLines.slice(0, headLimit);
      const truncated = totalMatches > paged.length;

      const header = `grep ${outputMode} — pattern=/${pattern}/  ${totalMatches} line${totalMatches === 1 ? "" : "s"}${truncated ? `  (showing ${paged.length})` : ""}`;
      const footer = truncated
        ? `\n\n[${totalMatches - paged.length} more lines — bump head_limit to see more]`
        : "";

      return textEnvelope(`${header}\n\n${paged.join("\n")}${footer}`);
    },
    source: "builtin",
    category: "read",
    concurrencySafe: true,
    isReadOnly: true,
    maxResultSizeChars: 128 * 1024,
  },
];
