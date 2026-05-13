import fs from "node:fs";
import path from "node:path";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { resolveTenantPath } from "./workspace";
import type { BuiltinToolContext } from "./types";
import { PDF_MAX_PAGES } from "./constants";

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

export const pdfTools: ToolRegistration[] = [
  {
    definition: {
      name: "read_pdf",
      description:
        "Extract text content from a PDF file in the agent workspace. " +
        "Returns the extracted text with page information.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the PDF file (relative to workspace)" },
          pages: { type: "string", description: 'Page range to extract (e.g. "1-5", "3", or omit for all, max 50)' },
        },
        required: ["path"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const filePath = resolveTenantPath(args.path as string, ctx.workspace);

      if (!fs.existsSync(filePath)) return { error: `File not found: ${args.path}` };
      if (path.extname(filePath).toLowerCase() !== ".pdf") {
        return { error: "File is not a PDF. Use read_file for text files." };
      }

      try {
        type PdfParseFn = (buffer: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number }>;
        let pdfParseFn: PdfParseFn;
        try {
          const modName = "pdf-parse";
          const mod = await import(/* webpackIgnore: true */ modName) as Record<string, unknown>;
          pdfParseFn = (mod.default || mod) as PdfParseFn;
        } catch {
          return { error: "pdf-parse is not installed. PDF reading is not available." };
        }

        const buffer = fs.readFileSync(filePath);
        const data = await pdfParseFn(buffer, { max: PDF_MAX_PAGES });

        let text = data.text || "";
        const totalPages = data.numpages || 0;

        if (args.pages && typeof args.pages === "string") {
          const match = args.pages.match(/^(\d+)(?:-(\d+))?$/);
          if (!match) return { error: `Invalid page range: "${args.pages}". Use "3" or "1-5".` };
          const pageNote = `(Note: pdf-parse extracts all text; page range "${args.pages}" is informational only)`;
          text = `${pageNote}\n\n${text}`;
        }

        text = text
          .replace(/\r\n/g, "\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        const header = `PDF: ${args.path} (${totalPages} page${totalPages === 1 ? "" : "s"}, ${text.length} chars extracted)`;
        return textEnvelope(`${header}\n\n${text}`);
      } catch (e: unknown) {
        return { error: `PDF extraction failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    source: "builtin",
    category: "read",
    concurrencySafe: true,
    isReadOnly: true,
    maxResultSizeChars: 64 * 1024,
  },
];
