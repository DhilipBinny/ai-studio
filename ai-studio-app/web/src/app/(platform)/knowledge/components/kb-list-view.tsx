"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, BookOpen, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";
import { formatDate } from "@/lib/utils";
import type { KnowledgeBase } from "./types";
import { CreateKBForm } from "./create-kb-form";
import { EditKBForm } from "./edit-kb-form";

interface KBListViewProps {
  onSelect: (id: string) => void;
}

export function KBListView({ onSelect }: KBListViewProps) {
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
    if (res.ok) {
      const d = await res.json();
      setKbs(d.data);
      setTotal(d.total);
      setTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchKbs(); }, [fetchKbs]);

  return (
    <>
      <PageHeader title="Knowledge Bases" description="Manage document collections for RAG-powered agents.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create KB</Button>
      </PageHeader>

      {!loading && kbs.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge bases yet"
          description="Create a knowledge base to upload documents for agent RAG."
          actionLabel="Create KB"
          onAction={() => setShowCreate(true)}
        />
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
              {loading ? (
                <TableSkeleton columns={6} />
              ) : (
                kbs.map((kb) => (
                  <TableRow key={kb.id} className="cursor-pointer" onClick={() => onSelect(kb.id)}>
                    <TableCell>
                      <div className="font-medium">{kb.name}</div>
                      {kb.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">{kb.description}</div>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{kb.embeddingModel}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{kb.documentCount}</TableCell>
                    <TableCell className="text-muted-foreground">{kb.chunkCount.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(kb.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={(e) => { e.stopPropagation(); setEditKB(kb); }}
                        aria-label="Edit knowledge base"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
      />

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
