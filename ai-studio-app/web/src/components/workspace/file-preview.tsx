"use client";

import { useState, useEffect } from "react";
import { X, Download, Loader2, AlertTriangle, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { formatSize } from "@/lib/utils";

interface FileData {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  content: string | null;
  truncated: boolean;
  binary: boolean;
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".sql", ".css", ".html", ".yaml", ".yml", ".xml", ".csv", ".env", ".toml"]);

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

export function FilePreview({
  scope, id, path: filePath, onClose,
}: {
  scope: "agent" | "run" | "shared" | "project";
  id?: string;
  path: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ scope, path: filePath });
    if (id) params.set("id", id);
    fetch(`/api/workspace/file?${params}`)
      .then((r) => r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error); }))
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [scope, id, filePath]);

  const downloadUrl = `/api/workspace/download?${new URLSearchParams({ scope, path: filePath, ...(id ? { id } : {}) })}`;
  const ext = getExtension(filePath);

  return (
    <Card className="mt-3">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{data?.name || filePath.split("/").pop()}</span>
          {data && <Badge variant="secondary" className="text-[10px] shrink-0">{formatSize(data.size)}</Badge>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {data && !data.binary && data.content !== null && (
            <CopyButton value={data.content} />
          )}
          <a href={downloadUrl} download className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted transition-colors">
            <Download className="h-3 w-3" /> Download
          </a>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {data && data.binary && (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <FileWarning className="h-8 w-8" />
            <p className="text-sm">Binary file — download to view</p>
            <a href={downloadUrl} download className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
              <Download className="h-3 w-3" /> Download {formatSize(data.size)}
            </a>
          </div>
        )}

        {data && !data.binary && data.content !== null && (
          <>
            {ext === ".md" ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown content={data.content} />
              </div>
            ) : ext === ".json" ? (
              <pre className="font-mono text-xs bg-muted/50 rounded-md p-3 overflow-x-auto max-h-[500px] overflow-y-auto">
                <code>{(() => { try { return JSON.stringify(JSON.parse(data.content), null, 2); } catch { return data.content; } })()}</code>
              </pre>
            ) : CODE_EXTENSIONS.has(ext) || ext === "" ? (
              <div className="font-mono text-xs bg-muted/50 rounded-md overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full">
                  <tbody>
                    {data.content.split("\n").map((line, i) => (
                      <tr key={i} className="hover:bg-muted/80">
                        <td className="text-right text-muted-foreground/50 select-none px-3 py-0 w-[1%] whitespace-nowrap border-r border-border/50">{i + 1}</td>
                        <td className="px-3 py-0 whitespace-pre">{line}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <pre className="font-mono text-xs bg-muted/50 rounded-md p-3 overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                {data.content}
              </pre>
            )}

            {data.truncated && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                File truncated to 100KB (full size: {formatSize(data.size)}).
                <a href={downloadUrl} download className="underline font-medium">Download full file</a>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
