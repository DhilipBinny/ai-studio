"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SYSTEM_CONFIG_SCHEMA, getConfigDefaults, type ConfigSectionDef, type ConfigFieldDef } from "@ais-app/types";
import { formatDate } from "@/lib/utils";

interface SystemConfig { id: string; key: string; value: Record<string, unknown>; updatedAt: string; }

function ConfigField({ field, value, onChange }: { field: ConfigFieldDef; value: unknown; onChange: (val: unknown) => void }) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <p className="text-sm">{field.label}</p>
          {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
        </div>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-brand" />
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.label}</Label>
        <Select value={String(value || field.default || "")} onChange={(e) => onChange(e.target.value)} className="h-9">
          {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </Select>
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{field.label}</Label>
        {field.description && <p className="text-[10px] text-muted-foreground">{field.description}</p>}
        <Input
          type="number"
          value={value !== null && value !== undefined ? String(value) : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          min={field.min}
          max={field.max}
          className="h-9 max-w-[200px]"
        />
      </div>
    );
  }

  if (field.type === "readonly") {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{field.label}</span>
        <span className="font-mono">{String(value || "—")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.label}</Label>
      <Input value={String(value || "")} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  );
}

export function GeneralTab() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/settings");
    if (res.ok) { const d = await res.json(); setConfigs(d?.data || []); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  function getSchema(key: string): ConfigSectionDef | undefined {
    return SYSTEM_CONFIG_SCHEMA.find((s) => s.key === key);
  }

  function startEdit(config: SystemConfig) {
    setEditingKey(config.key);
    setEditForm({ ...(config.value as Record<string, unknown>) });
    setMessage(null);
  }

  async function saveConfig(key: string, value: Record<string, unknown>) {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ key, value }] }),
    });
    if (res.ok) {
      setMessage({ text: "Saved", ok: true });
      setEditingKey(null);
      fetchConfigs();
    } else {
      const d = await res.json();
      setMessage({ text: d.error || "Failed to save", ok: false });
    }
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`rounded-md px-3 py-2 text-xs ${message.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <>
        {configs.filter((c) => getSchema(c.key)).map((c) => {
          const schema = getSchema(c.key)!;
          const isEditing = editingKey === c.key;

          return (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{schema.label}</p>
                  <p className="text-xs text-muted-foreground">{schema.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{formatDate(c.updatedAt)}</span>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => isEditing ? setEditingKey(null) : startEdit(c)} aria-label="Edit config">
                    {isEditing ? "Cancel" : "Edit"}
                  </Button>
                </div>
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-3">
                  {schema.fields.map((field) => (
                    <ConfigField key={field.key} field={field} value={editForm[field.key]} onChange={(val) => setEditForm((f) => ({ ...f, [field.key]: val }))} />
                  ))}
                  <Button size="sm" onClick={() => saveConfig(c.key, editForm)} disabled={saving}>
                    {saving ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Saving...</> : "Save"}
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {schema.fields.map((field) => {
                    const val = (c.value as Record<string, unknown>)[field.key];
                    return (
                      <div key={field.key} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{field.label}</span>
                        <span className="font-medium">{field.type === "boolean" ? (val ? "Enabled" : "Disabled") : String(val ?? "—")}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}

        {SYSTEM_CONFIG_SCHEMA.filter((s) => !configs.some((c) => c.key === s.key)).map((schema) => {
          const isEditing = editingKey === schema.key;
          const defaults = getConfigDefaults(schema.key);

          return (
            <Card key={schema.key} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{schema.label}</p>
                  <p className="text-xs text-muted-foreground">{schema.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[9px]">Default</Badge>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                    if (isEditing) { setEditingKey(null); } else {
                      setEditingKey(schema.key);
                      setEditForm({ ...defaults });
                      setMessage(null);
                    }
                  }} aria-label="Edit config">
                    {isEditing ? "Cancel" : "Edit"}
                  </Button>
                </div>
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-3">
                  {schema.fields.map((field) => (
                    <ConfigField key={field.key} field={field} value={editForm[field.key]} onChange={(val) => setEditForm((f) => ({ ...f, [field.key]: val }))} />
                  ))}
                  <Button size="sm" onClick={() => saveConfig(schema.key, editForm)} disabled={saving}>
                    {saving ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Saving...</> : "Save"}
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {schema.fields.map((field) => (
                    <div key={field.key} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{field.label}</span>
                      <span className="font-medium">{field.type === "boolean" ? (defaults[field.key] ? "Enabled" : "Disabled") : String(defaults[field.key] ?? "—")}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        </>
      )}
    </div>
  );
}
