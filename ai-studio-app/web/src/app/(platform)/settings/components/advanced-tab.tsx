"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SYSTEM_CONFIG_SCHEMA } from "@ais-app/types";

interface SystemConfig { id: string; key: string; value: Record<string, unknown>; updatedAt: string; }

export function AdvancedTab() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const fetchConfigs = useCallback(async () => {
    const schemaKeys = SYSTEM_CONFIG_SCHEMA.map((s) => s.key);
    setLoading(true);
    const res = await fetch("/api/settings");
    if (res.ok) {
      const d = await res.json();
      const all = (d?.data || []) as SystemConfig[];
      setConfigs(all.filter((c) => !schemaKeys.includes(c.key)));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  function startEdit() {
    const merged = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    setEditJson(JSON.stringify(merged, null, 2));
    setEditing(true);
    setMessage(null);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(editJson) as Record<string, unknown>;
      const entries = Object.entries(parsed).map(([key, value]) => ({ key, value }));
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (res.ok) {
        setMessage({ text: "Saved", ok: true });
        setEditing(false);
        fetchConfigs();
      } else {
        const d = await res.json();
        setMessage({ text: d.error || "Failed to save", ok: false });
      }
    } catch {
      setMessage({ text: "Invalid JSON", ok: false });
    }
    setSaving(false);
  }

  const merged = Object.fromEntries(configs.map((c) => [c.key, c.value]));

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">Advanced Configuration</p>
          <p className="text-xs text-muted-foreground">Agent limits, default model, and other dynamic settings (JSON)</p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => editing ? setEditing(false) : startEdit()} aria-label="Edit config">
          {editing ? "Cancel" : "Edit"}
        </Button>
      </div>

      {message && (
        <div className={`mt-3 rounded-md px-3 py-2 text-xs ${message.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <Skeleton className="mt-3 h-32 w-full" />
      ) : editing ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={editJson}
            onChange={(e) => setEditJson(e.target.value)}
            className="w-full font-mono text-xs"
            rows={Math.min(editJson.split("\n").length + 1, 20)}
          />
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Saving...</> : "Save"}
          </Button>
        </div>
      ) : (
        <pre className="mt-3 rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground overflow-auto max-h-64">
          {JSON.stringify(merged, null, 2)}
        </pre>
      )}
    </Card>
  );
}
