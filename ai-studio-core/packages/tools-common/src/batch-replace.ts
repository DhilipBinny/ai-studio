import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { getAgentWorkspacePath } from "./workspace";
import type { BuiltinToolContext } from "./types";

const execFile = promisify(execFileCb);

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

async function findFiles(workspace: string, glob: string): Promise<string[]> {
  const hasSlash = glob.includes("/");
  const cmd = hasSlash
    ? `find "${workspace}" -type f -path "*/${glob}" 2>/dev/null`
    : `find "${workspace}" -type f -name "${glob}" 2>/dev/null`;

  try {
    const { stdout } = await execFile("/bin/sh", ["-c", cmd], {
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export const batchReplaceTools: ToolRegistration[] = [
  {
    definition: {
      name: "batch_replace",
      description:
        "Find and replace text across multiple files matching a glob pattern. " +
        "Replaces ALL occurrences in each file. Supports regex with capture groups. " +
        "Returns per-file match count. Use dry_run to preview without writing.",
      parameters: {
        type: "object",
        properties: {
          glob: {
            type: "string",
            description: "Glob/filename pattern (e.g. '*.cs', '**/*.ts', 'src/**/*.sql'). Uses find -name or find -path.",
          },
          search: {
            type: "string",
            description: "Text or regex pattern to find",
          },
          replace: {
            type: "string",
            description: "Replacement text. For regex: $1, $2 for capture groups",
          },
          is_regex: {
            type: "boolean",
            description: "Treat search as regex (default: false = literal string match)",
          },
          case_insensitive: {
            type: "boolean",
            description: "Case-insensitive matching (default: false)",
          },
          dry_run: {
            type: "boolean",
            description: "Preview changes without modifying files (default: false)",
          },
          exclude: {
            type: "string",
            description: "Exclude paths containing this string (e.g. 'node_modules', 'bin')",
          },
        },
        required: ["glob", "search", "replace"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const workspace = getAgentWorkspacePath(ctx.workspace);
      const globPattern = args.glob as string;
      const search = args.search as string;
      const replace = args.replace as string;
      const isRegex = args.is_regex === true;
      const caseInsensitive = args.case_insensitive === true;
      const dryRun = args.dry_run === true;
      const exclude = args.exclude as string | undefined;

      if (!search) return { error: "search pattern is required" };
      if (!globPattern) return { error: "glob pattern is required" };

      let files = await findFiles(workspace, globPattern);

      if (exclude) {
        files = files.filter((f) => !f.includes(exclude));
      }

      if (files.length === 0) {
        return textEnvelope(`No files found matching: ${globPattern}`);
      }

      const MAX_FILES = 1000;
      if (files.length > MAX_FILES) {
        return { error: `Too many files (${files.length}). Narrow your glob or use exclude (max ${MAX_FILES}).` };
      }

      let regex: RegExp;
      try {
        const flags = "g" + (caseInsensitive ? "i" : "");
        regex = isRegex
          ? new RegExp(search, flags)
          : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      } catch (e) {
        return { error: `Invalid regex: ${(e as Error).message}` };
      }

      const results: Array<{ file: string; matches: number }> = [];
      let totalMatches = 0;
      let filesModified = 0;

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const matches = content.match(regex);
          if (!matches || matches.length === 0) continue;

          const matchCount = matches.length;
          totalMatches += matchCount;

          if (!dryRun) {
            const newContent = content.replace(regex, replace);
            if (newContent !== content) {
              fs.writeFileSync(filePath, newContent);
              filesModified++;
            }
          } else {
            filesModified++;
          }

          const relPath = path.relative(workspace, filePath);
          results.push({ file: relPath, matches: matchCount });
        } catch {
          // skip binary/unreadable files
        }
      }

      if (totalMatches === 0) {
        return textEnvelope(`No matches found for "${search}" in ${files.length} files scanned.`);
      }

      const action = dryRun ? "Would replace" : "Replaced";
      const lines = [
        `${action} ${totalMatches} occurrence${totalMatches === 1 ? "" : "s"} across ${filesModified} file${filesModified === 1 ? "" : "s"} (scanned ${files.length}):`,
        "",
      ];
      for (const r of results.slice(0, 40)) {
        lines.push(`  ${r.file} (${r.matches})`);
      }
      if (results.length > 40) {
        lines.push(`  ... and ${results.length - 40} more files`);
      }

      return textEnvelope(lines.join("\n"));
    },
    source: "builtin",
    category: "write",
    isDestructive: true,
  },
];
