"use client";

import { useState, useEffect, useCallback } from "react";
import { Folder, File, FileCode, FileText, ChevronRight, FolderOpen } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeleton } from "@/components/table-skeleton";
import { formatRelativeTime, formatSize } from "@/lib/utils";
import { FilePreview } from "./file-preview";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
}

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".sql", ".css", ".html", ".yaml", ".yml"]);
const TEXT_EXT = new Set([".md", ".txt", ".csv", ".log", ".env"]);

function FileIcon({ name, type }: { name: string; type: string }) {
  if (type === "directory") return <Folder className="h-4 w-4 text-amber-500" />;
  const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  if (CODE_EXT.has(ext)) return <FileCode className="h-4 w-4 text-blue-500" />;
  if (TEXT_EXT.has(ext) || ext === ".json") return <FileText className="h-4 w-4 text-green-600" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}


export function FileBrowser({
  scope, id, className,
}: {
  scope: "agent" | "run" | "shared" | "project";
  id?: string;
  className?: string;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ scope });
    if (id) params.set("id", id);
    if (currentPath) params.set("path", currentPath);
    try {
      const res = await fetch(`/api/workspace/files?${params}`);
      if (res.ok) {
        const d = await res.json();
        setFiles(d.files || []);
      } else {
        setFiles([]);
      }
    } catch {
      setFiles([]);
    }
    setLoading(false);
  }, [scope, id, currentPath]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => { setCurrentPath(""); setSelectedFile(null); }, [scope, id]);

  function handleClick(entry: FileEntry) {
    if (entry.type === "directory") {
      setCurrentPath(currentPath ? `${currentPath}/${entry.name}` : entry.name);
      setSelectedFile(null);
    } else {
      setSelectedFile(currentPath ? `${currentPath}/${entry.name}` : entry.name);
    }
  }

  function navigateUp(targetIndex: number) {
    const segments = currentPath.split("/").filter(Boolean);
    setCurrentPath(segments.slice(0, targetIndex).join("/"));
    setSelectedFile(null);
  }

  const pathSegments = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <div className={className}>
      {pathSegments.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2 flex-wrap">
          <button onClick={() => navigateUp(0)} className="hover:text-foreground font-medium">Root</button>
          {pathSegments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button onClick={() => navigateUp(i + 1)} className="hover:text-foreground font-medium">{seg}</button>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <TableSkeleton columns={3} />
      ) : files.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No files" description={currentPath ? "This directory is empty." : "This workspace has no files yet."} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-24 text-right">Size</TableHead>
              <TableHead className="w-32 text-right">Modified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((f) => (
              <TableRow key={f.name} className="cursor-pointer hover:bg-muted/50" onClick={() => handleClick(f)}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileIcon name={f.name} type={f.type} />
                    <span className="text-sm">{f.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{f.type === "file" ? formatSize(f.size) : ""}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{formatRelativeTime(f.modifiedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selectedFile && (
        <FilePreview
          scope={scope}
          id={id}
          path={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  );
}
