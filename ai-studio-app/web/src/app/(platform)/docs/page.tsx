"use client";

import { useState, useEffect, useCallback } from "react";
import { RequirePermission } from "@/components/require-permission";
import { PageHeader } from "@/components/page-header";
import { Markdown } from "@/components/markdown";
import { Loader2, FileText, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocFile {
  filename: string;
  title: string;
  sizeKb: number;
}

export default function DocsPage() {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    fetch("/api/docs").then((r) => r.json()).then((d) => {
      setFiles(d.files || []);
      setLoading(false);
    });
  }, []);

  const loadDoc = useCallback(async (filename: string) => {
    setSelected(filename);
    setLoadingContent(true);
    const res = await fetch(`/api/docs?path=${encodeURIComponent(filename)}`);
    if (res.ok) {
      const d = await res.json();
      setContent(d.content);
    }
    setLoadingContent(false);
  }, []);

  useEffect(() => {
    if (files.length > 0 && !selected) {
      loadDoc(files[0].filename);
    }
  }, [files, selected, loadDoc]);

  return (
    <RequirePermission module="DOCS"><>
      <PageHeader title="Docs" description="Platform feature documentation and design reference." />

      <div className="flex gap-4 h-[calc(100vh-14rem)]">
        {/* Sidebar — file list */}
        <div className="w-64 shrink-0 border border-border rounded-lg overflow-y-auto bg-card">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Feature Docs</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="py-1">
              {files.map((f) => (
                <button
                  key={f.filename}
                  onClick={() => loadDoc(f.filename)}
                  className={cn(
                    "flex items-center gap-2.5 w-full text-left px-4 py-2 text-sm transition-colors",
                    selected === f.filename
                      ? "bg-primary/5 text-primary font-medium"
                      : "text-foreground hover:bg-muted/50"
                  )}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate capitalize">{f.title}</div>
                    <div className="text-[10px] text-muted-foreground">{f.sizeKb} KB</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content — markdown renderer */}
        <div className="flex-1 border border-border rounded-lg overflow-y-auto bg-card">
          {loadingContent ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : content ? (
            <div className="px-8 py-6">
              <Markdown content={content} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <BookOpen className="h-8 w-8 mb-2" />
              <p className="text-sm">Select a document to view</p>
            </div>
          )}
        </div>
      </div>
    </></RequirePermission>
  );
}
