"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";
import { formatDate } from "@/lib/utils";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, BookOpen, Upload, Pencil, Trash2, Loader2, FileText, CheckCircle, AlertCircle, Clock, RefreshCw, Cpu, Cloud } from "lucide-react";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  embeddingSource: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkConfig: { method?: string; chunk_size?: number; chunk_overlap?: number };
  documentCount: number;
  chunkCount: number;
  createdAt: string;
}

interface EmbeddingProvider {
  id: string;
  name: string;
  providerType: string;
  models: Array<{ modelId: string; displayName: string }>;
}

interface Document {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  status: "uploaded" | "processing" | "ready" | "error";
  chunkCount: number;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
}

const STATUS_ICON: Record<string, typeof CheckCircle> = {
  ready: CheckCircle,
  processing: RefreshCw,
  uploaded: Clock,
  error: AlertCircle,
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "error"> = {
  ready: "success",
  processing: "warning",
  uploaded: "secondary",
  error: "error",
};

export default function KnowledgePage() {
  const [selectedKB, setSelectedKB] = useState<string | null>(null);

  if (selectedKB) {
    return (
      <RequirePermission module="KNOWLEDGE">
        <KBDetailView kbId={selectedKB} onBack={() => setSelectedKB(null)} />
      </RequirePermission>
    );
  }

  return (
    <RequirePermission module="KNOWLEDGE">
      <KBListView onSelect={setSelectedKB} />
    </RequirePermission>
  );
}

function KBListView({ onSelect }: { onSelect: (id: string) => void }) {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editKB, setEditKB] = useState<KnowledgeBase | null>(null);

  const fetchKbs = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/knowledge-bases?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`);
    if (res.ok) { const d = await res.json(); setKbs(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchKbs(); }, [fetchKbs]);

  return (
    <>
      <PageHeader title="Knowledge Bases" description="Manage document collections for RAG-powered agents.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create KB</Button>
      </PageHeader>

      {!loading && kbs.length === 0 ? (
        <EmptyState icon={BookOpen} title="No knowledge bases yet" description="Create a knowledge base to upload documents for agent RAG." actionLabel="Create KB" onAction={() => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Embedding Model</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={6} /> : kbs.map((kb) => (
                <TableRow key={kb.id} className="cursor-pointer" onClick={() => onSelect(kb.id)}>
                  <TableCell>
                    <div className="font-medium">{kb.name}</div>
                    {kb.description && <div className="text-xs text-muted-foreground line-clamp-1">{kb.description}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{kb.embeddingModel}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{kb.documentCount}</TableCell>
                  <TableCell className="text-muted-foreground">{kb.chunkCount.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(kb.createdAt)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); setEditKB(kb); }} aria-label="Edit knowledge base">
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={total} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={showCreate} onOpenChange={setShowCreate} size="xl">
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Create Knowledge Base</DialogTitle></DialogHeader>
          <CreateKBForm onCreated={() => { setShowCreate(false); fetchKbs(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editKB} onOpenChange={(open) => { if (!open) setEditKB(null); }} size="xl">
        <DialogContent onClose={() => setEditKB(null)}>
          <DialogHeader><DialogTitle>Edit Knowledge Base</DialogTitle></DialogHeader>
          {editKB && <EditKBForm kb={editKB} onSaved={() => { setEditKB(null); fetchKbs(); }} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function KBDetailView({ kbId, onBack }: { kbId: string; onBack: () => void }) {
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

      const uploadRes = await fetch(`/api/knowledge-bases/${kbId}/documents`, { method: "POST", body: formData });
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

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <>
      <div className="mb-6 space-y-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Knowledge Bases</BreadcrumbLink>
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
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Documents</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold tracking-tight">{kb?.documentCount ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Chunks</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold tracking-tight">{kb?.chunkCount?.toLocaleString() ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Embedding</CardTitle></CardHeader>
          <CardContent>
            <Badge variant="secondary" className="mt-1">{kb?.embeddingModel || "—"}</Badge>
            <p className="text-xs text-muted-foreground mt-1">{kb?.embeddingSource === "builtin" ? "Built-in (CPU)" : "External Provider"} &middot; {kb?.embeddingDimension} dims</p>
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
              {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              {uploading ? "Uploading..." : "Upload Files"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {uploadError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive mb-4">{uploadError}</div>
          )}

          {!loading && docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium">No documents yet</p>
              <p className="text-xs text-muted-foreground mt-1">Upload .txt, .md, .pdf, .docx, or .csv files to build the knowledge base.</p>
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
                {loading ? <TableSkeleton columns={6} /> : docs.map((doc) => {
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
                        {doc.errorMessage && <p className="text-xs text-destructive mt-1 line-clamp-1">{doc.errorMessage}</p>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{doc.status === "ready" ? doc.chunkCount.toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(doc.createdAt)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(doc.id)} aria-label="Delete document">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {docsTotalPages > 1 && (
        <Pagination page={docsPage} pageSize={15} total={docsTotal} totalPages={docsTotalPages} onPageChange={setDocsPage} />
      )}
    </>
  );
}

function CreateKBForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    embeddingSource: "builtin" as "builtin" | "provider",
    embeddingProviderId: "",
    embeddingModel: "Xenova/bge-small-en-v1.5",
    embeddingDimension: 384,
    chunkMethod: "recursive" as "recursive" | "parent_child",
    rerankSource: "" as "" | "builtin" | "provider",
    rerankProviderId: "",
    rerankModel: "",
  });
  const [embeddingProviders, setEmbeddingProviders] = useState<EmbeddingProvider[]>([]);
  const [rerankProviders, setRerankProviders] = useState<EmbeddingProvider[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/providers/embedding-models")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setEmbeddingProviders(d.data); })
      .catch(() => {});
    fetch("/api/providers/rerank-models")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data) setRerankProviders(d.data); })
      .catch(() => {});
  }, []);

  const selectedProvider = embeddingProviders.find((p) => p.id === form.embeddingProviderId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (form.embeddingSource === "provider" && !form.embeddingProviderId) {
      setError("Please select an embedding provider.");
      return;
    }
    if (form.embeddingSource === "provider" && !form.embeddingModel) {
      setError("Please select an embedding model.");
      return;
    }

    setSubmitting(true);
    const chunkConfig: Record<string, unknown> = form.chunkMethod === "parent_child"
      ? { method: "parent_child", parent_chunk_size: 2048, child_chunk_size: 512, chunk_overlap: 100 }
      : { method: "recursive", chunk_size: 2048, chunk_overlap: 200 };

    const res = await fetch("/api/knowledge-bases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        embeddingSource: form.embeddingSource,
        embeddingProviderId: form.embeddingSource === "provider" ? form.embeddingProviderId : null,
        embeddingModel: form.embeddingModel,
        embeddingDimension: form.embeddingDimension,
        rerankSource: form.rerankSource || null,
        rerankProviderId: form.rerankSource === "provider" ? form.rerankProviderId : null,
        rerankModel: form.rerankModel || null,
        chunkConfig,
      }),
    });
    if (res.ok) onCreated();
    else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Product Documentation" />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Collection of product docs for support agents" rows={2} />
      </div>

      <div className="border border-border rounded-lg p-3 space-y-3">
        <Label className="text-sm font-medium">Embedding Source</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input type="radio" name="embeddingSource" value="builtin" checked={form.embeddingSource === "builtin"}
              onChange={() => setForm((f) => ({ ...f, embeddingSource: "builtin", embeddingProviderId: "", embeddingModel: "Xenova/bge-small-en-v1.5", embeddingDimension: 384 }))}
              className="mt-1" />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium"><Cpu className="h-3.5 w-3.5" /> Built-in (free, no setup)</div>
              <p className="text-xs text-muted-foreground mt-0.5">bge-small-en-v1.5 — 384 dims, runs on CPU. Good for getting started.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input type="radio" name="embeddingSource" value="provider" checked={form.embeddingSource === "provider"}
              onChange={() => setForm((f) => ({ ...f, embeddingSource: "provider", embeddingModel: "", embeddingDimension: 1024 }))}
              className="mt-1" />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium"><Cloud className="h-3.5 w-3.5" /> External Provider</div>
              <p className="text-xs text-muted-foreground mt-0.5">OpenAI, Ollama, Voyage AI, or any compatible endpoint.</p>
            </div>
          </label>
        </div>

        {form.embeddingSource === "provider" && (
          <div className="space-y-3 pt-2 border-t">
            {embeddingProviders.length === 0 ? (
              <p className="text-xs text-amber-600">No embedding-capable providers found. Add a provider with embedding models first (test connection to discover them).</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <Select value={form.embeddingProviderId} onChange={(e) => {
                    const prov = embeddingProviders.find((p) => p.id === e.target.value);
                    setForm((f) => ({ ...f, embeddingProviderId: e.target.value, embeddingModel: prov?.models[0]?.modelId || "" }));
                  }}>
                    <option value="">Select provider...</option>
                    {embeddingProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.providerType})</option>
                    ))}
                  </Select>
                </div>
                {selectedProvider && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Model</Label>
                    <Select value={form.embeddingModel} onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))}>
                      {selectedProvider.models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="border border-border rounded-lg p-3 space-y-2">
        <Label className="text-sm font-medium">Chunking Method</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input type="radio" name="chunkMethod" value="recursive" checked={form.chunkMethod === "recursive"}
              onChange={() => setForm((f) => ({ ...f, chunkMethod: "recursive" }))} className="mt-1" />
            <div>
              <p className="text-sm font-medium">Standard</p>
              <p className="text-xs text-muted-foreground">Recursive splitting with contextual prefix. Good for most documents.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-2 rounded-md border border-border cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input type="radio" name="chunkMethod" value="parent_child" checked={form.chunkMethod === "parent_child"}
              onChange={() => setForm((f) => ({ ...f, chunkMethod: "parent_child" }))} className="mt-1" />
            <div>
              <p className="text-sm font-medium">Parent-Child</p>
              <p className="text-xs text-muted-foreground">Small chunks for precise search, returns parent chunk for broader context. Best for detailed technical docs.</p>
            </div>
          </label>
        </div>
      </div>

      <div className="border border-border rounded-lg p-3 space-y-2">
        <Label className="text-sm font-medium">Re-ranking</Label>
        <Select value={form.rerankSource} onChange={(e) => setForm((f) => ({ ...f, rerankSource: e.target.value as "" | "builtin" | "provider", rerankProviderId: "", rerankModel: "" }))}>
          <option value="">Disabled (default)</option>
          <option value="builtin">Built-in (ms-marco-MiniLM, CPU, free)</option>
          <option value="provider">External Provider (Cohere, Voyage, Jina)</option>
        </Select>
        <p className="text-xs text-muted-foreground">Re-ranking scores each result against the query for better precision. Adds ~50-200ms latency.</p>

        {form.rerankSource === "provider" && (
          <div className="space-y-3 pt-2 border-t">
            {rerankProviders.length === 0 ? (
              <p className="text-xs text-amber-600">No rerank-capable providers found. Add a provider with rerank models first.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider</Label>
                  <Select value={form.rerankProviderId} onChange={(e) => {
                    const prov = rerankProviders.find((p) => p.id === e.target.value);
                    setForm((f) => ({ ...f, rerankProviderId: e.target.value, rerankModel: prov?.models[0]?.modelId || "" }));
                  }}>
                    <option value="">Select provider...</option>
                    {rerankProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.providerType})</option>
                    ))}
                  </Select>
                </div>
                {form.rerankProviderId && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Model</Label>
                    <Select value={form.rerankModel} onChange={(e) => setForm((f) => ({ ...f, rerankModel: e.target.value }))}>
                      {rerankProviders.find((p) => p.id === form.rerankProviderId)?.models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create"}
      </Button>
    </form>
  );
}

function EditKBForm({ kb, onSaved }: { kb: KnowledgeBase; onSaved: () => void }) {
  const [form, setForm] = useState({ name: kb.name, description: kb.description || "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const body: Record<string, string> = {};
    if (form.name !== kb.name) body.name = form.name;
    if (form.description !== (kb.description || "")) body.description = form.description;

    if (Object.keys(body).length === 0) { setError("No changes to save."); setSubmitting(false); return; }

    const res = await fetch(`/api/knowledge-bases/${kb.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) onSaved();
    else { const d = await res.json(); setError(d.error || "Failed to update"); }
    setSubmitting(false);
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/knowledge-bases/${kb.id}`, { method: "DELETE" });
    if (res.ok) onSaved();
    else { const d = await res.json(); setError(d.error || "Failed to delete"); }
    setDeleting(false);
    setShowDeleteDialog(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Model: {kb.embeddingModel} &middot; {kb.documentCount} docs &middot; {kb.chunkCount.toLocaleString()} chunks</p>
      </div>

      <div className="space-y-2">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setShowDeleteDialog(true)}>Delete</Button>
        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={handleDelete}
          title="Delete knowledge base"
          description={`Are you sure you want to delete "${kb.name}"? All documents and chunks will be permanently removed.`}
          confirmLabel="Delete"
          loading={deleting}
        />
      </div>
    </form>
  );
}
