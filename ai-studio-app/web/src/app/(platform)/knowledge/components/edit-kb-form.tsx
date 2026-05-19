"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError } from "@/components/form-error";
import type { KnowledgeBase } from "./types";

interface EditKBFormProps {
  kb: KnowledgeBase;
  onSaved: () => void;
}

export function EditKBForm({ kb, onSaved }: EditKBFormProps) {
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

    if (Object.keys(body).length === 0) {
      setError("No changes to save.");
      setSubmitting(false);
      return;
    }

    const res = await fetch(`/api/knowledge-bases/${kb.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      onSaved();
    } else {
      const d = await res.json();
      setError(d.error || "Failed to update");
    }
    setSubmitting(false);
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/knowledge-bases/${kb.id}`, { method: "DELETE" });
    if (res.ok) {
      onSaved();
    } else {
      const d = await res.json();
      setError(d.error || "Failed to delete");
    }
    setDeleting(false);
    setShowDeleteDialog(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <FormError message={error} />

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Model: {kb.embeddingModel} &middot; {kb.documentCount} docs &middot; {kb.chunkCount.toLocaleString()} chunks
        </p>
      </div>

      <div className="space-y-2">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={2}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
            : "Save Changes"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setShowDeleteDialog(true)}>
          Delete
        </Button>
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
