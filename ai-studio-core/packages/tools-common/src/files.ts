import { FILE_MAX_WRITE_SIZE } from "./constants";
import fs from "node:fs";
import path from "node:path";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { resolveTenantPath, getAgentWorkspacePath } from "./workspace";
import type { BuiltinToolContext } from "./types";

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

export const fileTools: ToolRegistration[] = [
  {
    definition: {
      name: "read_file",
      description:
        "Read the contents of a file from the agent workspace. Returns text content. " +
        "Use optional offset/limit to read a line range.",
      alwaysLoad: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to read (relative to workspace)" },
          offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
          limit: { type: "number", description: "Maximum number of lines to read" },
        },
        required: ["path"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const filePath = resolveTenantPath(args.path as string, ctx.workspace);
      if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return { error: `"${args.path}" is a directory, not a file. Use list_directory instead.` };

      const fullContent = fs.readFileSync(filePath, "utf8");
      const lines = fullContent.split("\n");
      const totalLines = lines.length;
      const offset = Math.max(0, ((args.offset as number) || 1) - 1);
      const limit = (args.limit as number) || lines.length;
      const sliced = lines.slice(offset, offset + limit);
      const slicedText = sliced.join("\n");

      const isPartial = offset > 0 || limit < totalLines;
      const header = isPartial
        ? `File: ${args.path} (lines ${offset + 1}-${Math.min(offset + limit, totalLines)} of ${totalLines})\n`
        : `File: ${args.path} (${totalLines} line${totalLines === 1 ? "" : "s"})\n`;

      return textEnvelope(header + slicedText);
    },
    source: "builtin",
    category: "read",
    concurrencySafe: true,
    isReadOnly: true,
    maxResultSizeChars: 64 * 1024,
  },
  {
    definition: {
      name: "write_file",
      description:
        "Write content to a file in the agent workspace. Creates parent directories automatically. Overwrites existing files.",
      alwaysLoad: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to write (relative to workspace)" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const filePath = resolveTenantPath(args.path as string, ctx.workspace);
      const fileContent = (args.content as string) || "";
      const contentSize = Buffer.byteLength(fileContent);
      if (contentSize > FILE_MAX_WRITE_SIZE) {
        return { error: `Content too large: ${(contentSize / 1024 / 1024).toFixed(1)}MB exceeds ${FILE_MAX_WRITE_SIZE / 1024 / 1024}MB limit` };
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      try {
        fs.writeFileSync(filePath, fileContent);
      } catch (e: unknown) {
        return { error: `Failed to write file: ${e instanceof Error ? e.message : String(e)}` };
      }

      const workspace = getAgentWorkspacePath(ctx.workspace);
      const savedPath = path.relative(workspace, filePath);
      return textEnvelope(`Wrote ${contentSize} byte${contentSize === 1 ? "" : "s"} to ${savedPath}`);
    },
    source: "builtin",
    category: "write",
    isDestructive: true,
  },
  {
    definition: {
      name: "edit_file",
      description:
        "Edit a file by replacing exact text. The old_string must match exactly (including whitespace).",
      alwaysLoad: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to edit" },
          old_string: { type: "string", description: "Exact text to find and replace" },
          new_string: { type: "string", description: "New text to replace with" },
          replace_all: {
            type: "boolean",
            description: "When true, replace every occurrence. When false (default), old_string must match exactly once.",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const filePath = resolveTenantPath(args.path as string, ctx.workspace);

      if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };
      let content = fs.readFileSync(filePath, "utf8");
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const replaceAll = args.replace_all === true;

      if (oldStr === newStr) {
        return { error: "old_string and new_string are identical — nothing to do." };
      }
      if (!content.includes(oldStr)) {
        return { error: "old_string not found in file. Make sure it matches exactly." };
      }

      if (replaceAll) {
        const matches = content.split(oldStr).length - 1;
        content = content.split(oldStr).join(newStr);
        try {
          fs.writeFileSync(filePath, content);
        } catch (e: unknown) {
          return { error: `Failed to write file: ${e instanceof Error ? e.message : String(e)}` };
        }
        return textEnvelope(`Edited ${args.path} — replaced ${matches} occurrence${matches === 1 ? "" : "s"}.`);
      }

      const firstIdx = content.indexOf(oldStr);
      if (content.indexOf(oldStr, firstIdx + 1) !== -1) {
        return { error: "old_string matches more than once in the file. Include more surrounding context so the match is unique, or pass replace_all: true." };
      }

      content = content.replace(oldStr, newStr);
      try {
        fs.writeFileSync(filePath, content);
      } catch (e: unknown) {
        return { error: `Failed to write file: ${e instanceof Error ? e.message : String(e)}` };
      }

      return textEnvelope(`Edited ${args.path}`);
    },
    source: "builtin",
    category: "write",
    isDestructive: true,
    validateInput: (input) => {
      const i = input as { old_string?: unknown; new_string?: unknown };
      if (typeof i.old_string !== "string" || i.old_string.length === 0) {
        return { ok: false, error: "old_string must be a non-empty string" };
      }
      if (typeof i.new_string !== "string") {
        return { ok: false, error: "new_string must be a string" };
      }
      if (i.old_string === i.new_string) {
        return { ok: false, error: "old_string and new_string must differ" };
      }
      return { ok: true };
    },
  },
  {
    definition: {
      name: "list_directory",
      description: "List files and directories at a given path in the agent workspace.",
      alwaysLoad: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to list (default: workspace root)" },
        },
        required: [],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const dirPath = resolveTenantPath((args.path as string) || "", ctx.workspace);
      if (!fs.existsSync(dirPath)) return { error: `Directory not found: ${args.path || "."}` };

      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return { error: `"${args.path}" is a file, not a directory.` };

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();

      const workspace = getAgentWorkspacePath(ctx.workspace);
      const displayPath = args.path || path.relative(workspace, dirPath) || ".";
      const header = `Directory: ${displayPath} (${lines.length} item${lines.length === 1 ? "" : "s"})\n`;
      return textEnvelope(header + lines.join("\n"));
    },
    source: "builtin",
    category: "read",
    concurrencySafe: true,
    isReadOnly: true,
  },
];
