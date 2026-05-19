"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Upload, Trash2, Loader2, FileText, CheckCircle, AlertCircle, Clock, RefreshCw } from "lucide-react";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { FormError } from "@/components/form-error";
import { STATUS_VARIANT } from "@/lib/constants";
import { formatDate, formatSize } from "@/lib/utils";
import type { KnowledgeBase, Document } from "./types";

const STATUS_ICON: Record<string, typeof CheckCircle> = {
  ready: CheckCircle,
  processing: RefreshCw,
  uploaded: Clock,
  error: AlertCircle,
};

interface KBDetailViewProps {
  kbId: string;
  onBack: () => void;
}

export function KBDetailView({ kbId, onBack }: KBDetailViewProps) {
  const [kb, setKB] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [docsTotal, setDocsTotal] = useState(0);
  const [docsPage, setDocsPage] = useState(1);
  const [docsTotalPages, setDocsTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchKB = useCallback(async () => {
    const res = await fetch(`/api/knowledge-bases/${kbId}`);
    if (res.ok) setKB(await res.json());
  }, [kbId]);

  const fetchDocs = useCallback(async () => {
    const res = await fetch(`/api/knowledge-bases/${kbId}/documents?page=${docsPage}&pageSize=15`);
    if (res.ok) {
      const d = await res.json();
      setDocs(d.data);
      setDocsTotal(d.total);
      setDocsTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [kbId, docsPage]);

  useEffect(() => { fetchKB(); fetchDocs(); }, [fetchKB, fetchDocs]);

  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === "uploaded" || d.status === "processing");
    if (hasProcessing) {
      pollRef.current = setInterval(() => { fetchDocs(); fetchKB(); }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [docs, fetchDocs, fetchKB]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError("");
    setUploading(true);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch(`/api/knowledge-bases/${kbId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const d = await uploadRes.json();
        setUploadError(d.error || `Failed to upload ${file.name}`);
        setUploading(false);
        return;
      }

      const doc = await uploadRes.json();
      await fetch(`/api/knowledge-bases/${kbId}/documents/${doc.id}/process`, { method: "POST" });
    }

    setUploading(false);
    fetchDocs();
    fetchKB();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(docId: string) {
    const res = await fetch(`/api/knowledge-bases/${kbId}/documents/${docId}`, { method: "DELETE" });
    if (res.ok) { fetchDocs(); fetchKB(); }
  }

  return (
    <>
      <div className="mb-6 space-y-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
                Knowledge Bases
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{kb?.name || "..."}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{kb?.name || "..."}</h1>
          {kb?.description && <p className="text-sm text-muted-foreground">{kb.description}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight">{kb?.documentCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Chunks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight">{kb?.chunkCount?.toLocaleString() ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Embedding</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary" className="mt-1">{kb?.embeddingModel || "—"}</Badge>
            <p className="text-xs text-muted-foreground mt-1">
              {kb?.embeddingSource === "builtin" ? "Built-in (CPU)" : "External Provider"} &middot; {kb?.embeddingDimension} dims
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-medium">Documents</CardTitle>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.pdf,.csv,.docx"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <Upload className="h-4 w-4 mr-1" />}
              {uploading ? "Uploading..." : "Upload Files"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {uploadError && <div className="mb-4"><FormError message={uploadError} /></div>}

          {!loading && docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium">No documents yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Upload .txt, .md, .pdf, .docx, or .csv files to build the knowledge base.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" /> Upload Files
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton columns={6} />
                ) : (
                  docs.map((doc) => {
                    const StatusIcon = STATUS_ICON[doc.status] || Clock;
                    return (
                      <TableRow key={doc.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium text-sm">{doc.fileName}</div>
                              <div className="text-xs text-muted-foreground font-mono">.{doc.fileType}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatSize(doc.fileSizeBytes)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[doc.status] || "secondary"} className="gap-1">
                            <StatusIcon className={`h-3 w-3 ${doc.status === "processing" ? "animate-spin" : ""}`} />
                            {doc.status}
                          </Badge>
                          {doc.errorMessage && (
                            <p className="text-xs text-destructive mt-1 line-clamp-1">{doc.errorMessage}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {doc.status === "ready" ? doc.chunkCount.toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(doc.createdAt)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(doc.id)}
                            aria-label="Delete document"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {docsTotalPages > 1 && (
        <Pagination
          page={docsPage}
          pageSize={15}
          total={docsTotal}
          totalPages={docsTotalPages}
          onPageChange={setDocsPage}
        />
      )}
    </>
  );
}
