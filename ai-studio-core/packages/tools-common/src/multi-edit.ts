import fs from "node:fs";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { resolveTenantPath } from "./workspace";
import type { BuiltinToolContext } from "./types";

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

function generateDiff(original: string, modified: string, filePath: string): string {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");
  const hunks: string[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
      continue;
    }
    const startI = i;
    const startJ = j;
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) i++;
    while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) j++;
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      const ctx = Math.min(2, startI);
      hunks.push(`@@ -${startI - ctx + 1},${i - startI + ctx * 2} +${startJ - ctx + 1},${j - startJ + ctx * 2} @@`);
      for (let c = startI - ctx; c < startI; c++) hunks.push(` ${oldLines[c]}`);
      for (let c = startI; c < i; c++) hunks.push(`-${oldLines[c]}`);
      for (let c = startJ; c < j; c++) hunks.push(`+${newLines[c]}`);
      const endCtx = Math.min(2, oldLines.length - i);
      for (let c = 0; c < endCtx; c++) { hunks.push(` ${oldLines[i + c]}`); }
    }
  }

  if (hunks.length === 0) return "";
  return `--- ${filePath}\n+++ ${filePath}\n${hunks.join("\n")}`;
}

export const multiEditTools: ToolRegistration[] = [
  {
    definition: {
      name: "multi_edit",
      description:
        "Apply multiple string replacements to a single file in one atomic operation. " +
        "Much more efficient than calling edit_file multiple times. " +
        "Each edit is a {old_string, new_string} pair applied sequentially. Returns a diff of all changes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to edit" },
          edits: {
            type: "array",
            items: {
              type: "object",
              description: "Edit pair with old_string and new_string fields",
            },
            description: "Array of {old_string, new_string} pairs to apply sequentially",
          },
        },
        required: ["path", "edits"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const filePath = resolveTenantPath(args.path as string, ctx.workspace);

      if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };

      const edits = args.edits as Array<{ old_string: string; new_string: string }>;
      if (!Array.isArray(edits) || edits.length === 0) {
        return { error: "edits must be a non-empty array of {old_string, new_string} pairs" };
      }
      if (edits.length > 50) {
        return { error: "Maximum 50 edits per call" };
      }

      const original = fs.readFileSync(filePath, "utf8");
      let content = original;
      const applied: string[] = [];
      const failed: string[] = [];

      for (let i = 0; i < edits.length; i++) {
        const { old_string, new_string } = edits[i];
        if (!old_string || typeof old_string !== "string") {
          failed.push(`#${i + 1}: old_string is empty or invalid`);
          continue;
        }
        if (old_string === new_string) {
          failed.push(`#${i + 1}: old_string equals new_string`);
          continue;
        }
        if (!content.includes(old_string)) {
          failed.push(`#${i + 1}: "${old_string.slice(0, 40)}..." not found`);
          continue;
        }
        content = content.replace(old_string, new_string);
        applied.push(`#${i + 1}: replaced "${old_string.slice(0, 30)}..."`);
      }

      if (applied.length === 0) {
        return { error: `No edits applied. Failures:\n${failed.join("\n")}` };
      }

      try {
        fs.writeFileSync(filePath, content);
      } catch (e: unknown) {
        return { error: `Failed to write: ${e instanceof Error ? e.message : String(e)}` };
      }

      const diff = generateDiff(original, content, args.path as string);
      const summary = [`Applied ${applied.length}/${edits.length} edits to ${args.path}`];
      if (failed.length > 0) summary.push(`\nFailed (${failed.length}):\n${failed.join("\n")}`);
      if (diff) summary.push(`\n${diff.slice(0, 2000)}`);

      return textEnvelope(summary.join("\n"));
    },
    source: "builtin",
    category: "write",
    isDestructive: true,
    validateInput: (input) => {
      const i = input as { path?: unknown; edits?: unknown };
      if (typeof i.path !== "string" || !i.path) return { ok: false, error: "path is required" };
      if (!Array.isArray(i.edits) || i.edits.length === 0) return { ok: false, error: "edits must be a non-empty array" };
      return { ok: true };
    },
  },
  {
    definition: {
      name: "delete_lines",
      description:
        "Delete lines from a file by line range, optionally filtered by regex pattern. " +
        "Efficient for removing comments, imports, or repeated patterns without reading the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          start_line: { type: "number", description: "First line to consider (1-indexed, default: 1)" },
          end_line: { type: "number", description: "Last line to consider (default: end of file)" },
          pattern: { type: "string", description: "Regex pattern — only delete lines matching this" },
          invert: { type: "boolean", description: "If true, delete lines NOT matching the pattern (keep only matches)" },
        },
        required: ["path"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const filePath = resolveTenantPath(args.path as string, ctx.workspace);

      if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };

      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      const startLine = Math.max(1, (args.start_line as number) || 1);
      const endLine = Math.min(lines.length, (args.end_line as number) || lines.length);
      const pattern = args.pattern as string | undefined;
      const invert = args.invert === true;

      let regex: RegExp | null = null;
      if (pattern) {
        try {
          regex = new RegExp(pattern);
        } catch (e) {
          return { error: `Invalid regex: ${(e as Error).message}` };
        }
      }

      const result: string[] = [];
      let deleted = 0;

      for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        if (lineNum < startLine || lineNum > endLine) {
          result.push(lines[i]);
          continue;
        }
        if (!regex) {
          deleted++;
          continue;
        }
        const matches = regex.test(lines[i]);
        const shouldDelete = invert ? !matches : matches;
        if (shouldDelete) {
          deleted++;
        } else {
          result.push(lines[i]);
        }
      }

      if (deleted === 0) {
        return textEnvelope(`No lines matched for deletion in ${args.path}`);
      }

      try {
        fs.writeFileSync(filePath, result.join("\n"));
      } catch (e: unknown) {
        return { error: `Failed to write: ${e instanceof Error ? e.message : String(e)}` };
      }

      return textEnvelope(`Deleted ${deleted} line${deleted === 1 ? "" : "s"} from ${args.path} (${lines.length} → ${result.length} lines)`);
    },
    source: "builtin",
    category: "write",
    isDestructive: true,
  },
  {
    definition: {
      name: "insert_lines",
      description:
        "Insert text at a specific line number in a file. Existing content shifts down.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          line: { type: "number", description: "Line number to insert BEFORE (1-indexed). Use 0 or 1 for start, -1 for end." },
          content: { type: "string", description: "Text to insert (can be multiple lines)" },
        },
        required: ["path", "line", "content"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const filePath = resolveTenantPath(args.path as string, ctx.workspace);

      if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };

      const existing = fs.readFileSync(filePath, "utf8");
      const lines = existing.split("\n");
      const insertContent = args.content as string;
      let lineNum = args.line as number;

      if (lineNum <= 0 || lineNum === 1) lineNum = 1;
      if (lineNum === -1 || lineNum > lines.length) lineNum = lines.length + 1;

      const insertLines = insertContent.split("\n");
      lines.splice(lineNum - 1, 0, ...insertLines);

      try {
        fs.writeFileSync(filePath, lines.join("\n"));
      } catch (e: unknown) {
        return { error: `Failed to write: ${e instanceof Error ? e.message : String(e)}` };
      }

      return textEnvelope(`Inserted ${insertLines.length} line${insertLines.length === 1 ? "" : "s"} at line ${lineNum} in ${args.path}`);
    },
    source: "builtin",
    category: "write",
    isDestructive: true,
  },
];
