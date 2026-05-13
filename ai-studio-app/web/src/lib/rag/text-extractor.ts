import { readFile } from "fs/promises";
import { join } from "path";

const UPLOAD_BASE = join(process.cwd(), "..", ".data", "uploads");

export async function extractText(storagePath: string, fileType: string): Promise<string> {
  const fullPath = join(UPLOAD_BASE, storagePath);
  const buffer = await readFile(fullPath);

  switch (fileType) {
    case "txt":
    case "md":
    case "csv":
      return buffer.toString("utf-8");

    case "pdf":
      return extractPdf(buffer);

    case "docx":
      return extractDocx(buffer);

    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
