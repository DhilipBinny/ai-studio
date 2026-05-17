"use client";
import { RequirePermission } from "@/components/require-permission";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { SYSTEM_CONFIG_SCHEMA, getConfigDefaults, MODULES, type ConfigSectionDef, type ConfigFieldDef } from "@ais-app/types";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Copy, Key, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PasswordInput } from "@/components/password-input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Pagination } from "@/components/pagination";

interface SystemConfig { id: string; key: string; value: Record<string, unknown>; updatedAt: string; }
interface Profile { id: string; name: string; description: string; accessRights: Record<string, number>; isSystem: boolean; }

export default function SettingsPage() {
  const [tab, setTab] = useState("general");
  return (
    <RequirePermission module="SETTINGS"><>
      <PageHeader title="Settings" description="Configure platform settings and access profiles." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="profiles"><ProfilesTab /></TabsContent>
        <TabsContent value="api-keys"><ApiKeysTab /></TabsContent>
        <TabsContent value="advanced"><AdvancedTab /></TabsContent>
      </Tabs>
    </></RequirePermission>
  );
}

function GeneralTab() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const [editJson, setEditJson] = useState("");
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
    setEditJson(JSON.stringify(config.value, null, 2));
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

  async function saveStructured(key: string) {
    await saveConfig(key, editForm);
  }

  async function saveJson(key: string) {
    try {
      const parsed = JSON.parse(editJson);
      await saveConfig(key, parsed);
    } catch {
      setMessage({ text: "Invalid JSON", ok: false });
    }
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
        {/* Schema-defined configs: structured forms */}
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
                    <ConfigField
                      key={field.key}
                      field={field}
                      value={editForm[field.key]}
                      onChange={(val) => setEditForm((f) => ({ ...f, [field.key]: val }))}
                    />
                  ))}
                  <Button size="sm" onClick={() => saveStructured(c.key)} disabled={saving}>
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
                        <span className="font-medium">
                          {field.type === "boolean" ? (val ? "Enabled" : "Disabled") : String(val ?? "—")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}

        {/* Schema sections not yet saved — show defaults with edit option */}
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
                    <ConfigField
                      key={field.key}
                      field={field}
                      value={editForm[field.key]}
                      onChange={(val) => setEditForm((f) => ({ ...f, [field.key]: val }))}
                    />
                  ))}
                  <Button size="sm" onClick={() => saveStructured(schema.key)} disabled={saving}>
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

function AdvancedTab() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const schemaKeys = SYSTEM_CONFIG_SCHEMA.map((s) => s.key);

  const fetchConfigs = useCallback(async () => {
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

function ConfigField({ field, value, onChange }: { field: ConfigFieldDef; value: unknown; onChange: (val: unknown) => void }) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <p className="text-sm">{field.label}</p>
          {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
        </div>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-brand"
        />
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
      <Input
        value={String(value || "")}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
      />
    </div>
  );
}

const MODULE_IDS = MODULES.map((m) => m.id);
const LEVELS = [0, 10, 20] as const;
const LEVEL_LABELS: Record<number, string> = { 0: "None", 10: "View", 20: "Full" };
const LEVEL_VARIANTS: Record<number, "success" | "warning" | "secondary"> = { 20: "success", 10: "warning", 0: "secondary" };

function nextLevel(current: number): number {
  if (current === 0) return 10;
  if (current === 10) return 20;
  return 0;
}

function ProfilesTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRights, setEditRights] = useState<Record<string, number>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createRights, setCreateRights] = useState<Record<string, number>>(
    Object.fromEntries(MODULE_IDS.map((m) => [m, 0]))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/profiles");
    if (res.ok) { const d = await res.json(); setProfiles(d?.data || []); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  function startEdit(profile: Profile) {
    setEditingId(profile.id);
    setEditRights({ ...profile.accessRights });
    setMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditRights({});
  }

  async function saveEdit(profileId: string) {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/profiles/${profileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessRights: editRights }),
    });
    if (res.ok) {
      setMessage({ text: "Profile updated", ok: true });
      setEditingId(null);
      fetchProfiles();
    } else {
      const d = await res.json();
      setMessage({ text: d.error || "Failed to update", ok: false });
    }
    setSaving(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: createName, accessRights: createRights }),
    });
    if (res.ok) {
      setMessage({ text: "Profile created", ok: true });
      setShowCreate(false);
      setCreateName("");
      setCreateRights(Object.fromEntries(MODULE_IDS.map((m) => [m, 0])));
      fetchProfiles();
    } else {
      const d = await res.json();
      setMessage({ text: d.error || "Failed to create", ok: false });
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/profiles/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      setMessage({ text: "Profile deleted", ok: true });
      fetchProfiles();
    } else {
      const d = await res.json();
      setMessage({ text: d.error || "Failed to delete", ok: false });
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Click a permission badge to cycle: None → View → Full</p>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "+ New Profile"}
        </Button>
      </div>

      {message && (
        <div className={`rounded-md px-3 py-2 text-xs ${message.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {message.text}
        </div>
      )}

      {showCreate && (
        <Card className="p-4">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Profile Name</Label>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. Operator" className="max-w-xs" required />
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {MODULE_IDS.map((m) => (
                      <th key={m} className="px-2 py-1 text-center font-medium text-muted-foreground">{m.slice(0, 6)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {MODULE_IDS.map((m) => {
                      const val = createRights[m] ?? 0;
                      return (
                        <td key={m} className="px-2 py-1 text-center">
                          <button type="button" onClick={() => setCreateRights((r) => ({ ...r, [m]: nextLevel(r[m] ?? 0) }))}>
                            <Badge variant={LEVEL_VARIANTS[val]} className="cursor-pointer">{LEVEL_LABELS[val]}</Badge>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <Button type="submit" size="sm" disabled={saving}>{saving ? "Creating..." : "Create Profile"}</Button>
          </form>
        </Card>
      )}

      <Card>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px]">Profile</TableHead>
                {MODULE_IDS.map((m) => (
                  <TableHead key={m} className="text-center text-[10px] min-w-[52px] px-1">{m.slice(0, 6)}</TableHead>
                ))}
                <TableHead className="text-center min-w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={MODULE_IDS.length + 2} rows={4} /> : profiles.map((p) => {
                const isEditing = editingId === p.id;
                const rights = isEditing ? editRights : (p.accessRights as Record<string, number>);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{p.name}</span>
                        {p.isSystem && <Badge variant="outline" className="text-[10px] px-1 py-0">System</Badge>}
                      </div>
                    </TableCell>
                    {MODULE_IDS.map((m) => {
                      const val = rights[m] ?? 0;
                      return (
                        <TableCell key={m} className="text-center px-1">
                          {isEditing ? (
                            <button type="button" onClick={() => setEditRights((r) => ({ ...r, [m]: nextLevel(r[m] ?? 0) }))}>
                              <Badge variant={LEVEL_VARIANTS[val]} className="cursor-pointer text-[10px] px-1.5">{LEVEL_LABELS[val]}</Badge>
                            </button>
                          ) : (
                            <Badge variant={LEVEL_VARIANTS[val]} className="text-[10px] px-1.5">{LEVEL_LABELS[val]}</Badge>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center">
                      {isEditing ? (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => saveEdit(p.id)} disabled={saving}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={cancelEdit}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => startEdit(p)}>Edit</Button>
                          {!p.isSystem && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground" onClick={() => setDeleteTarget({ id: p.id, name: p.name })}>Delete</Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={handleDelete}
        title="Delete profile"
        description={`Delete "${deleteTarget?.name || ""}"? Users with this profile will lose their permissions.`}
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopedAgentIds: string[];
  rateLimitRpm: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/api-keys");
    if (res.ok) { const d = await res.json(); setKeys(d.data); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedKey(data.key);
      setNewKeyName("");
      fetchKeys();
    }
    setCreating(false);
  }

  async function handleRevoke(id: string) {
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    fetchKeys();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">API Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            API keys allow external systems to access agents via the REST API at <code className="bg-muted px-1 py-0.5 rounded text-xs">/api/v1/agents/:slug/sessions</code>
          </p>

          {createdKey && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
              <p className="text-sm font-medium text-green-800">API key created. Copy it now — it won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white border border-border rounded px-2 py-1 text-xs font-mono break-all">{createdKey}</code>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => { navigator.clipboard.writeText(createdKey); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCreatedKey(null)}>Dismiss</Button>
            </div>
          )}

          <div className="flex gap-2">
            <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} placeholder="Key name (e.g. TK3 Production)" className="flex-1" />
            <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Key className="h-4 w-4 mr-1" /> Create</>}
            </Button>
          </div>

          {loading ? (
            <TableSkeleton columns={5} />
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No API keys created yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id} className={!k.isActive ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{k.keyPrefix}...</TableCell>
                    <TableCell>
                      <Badge variant={k.isActive ? "success" : "secondary"}>{k.isActive ? "Active" : "Revoked"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      {k.isActive && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => handleRevoke(k.id)} aria-label="Revoke API key">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">API Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            External systems authenticate with <code className="bg-muted px-1 py-0.5 rounded text-xs">Authorization: Bearer ask_xxx</code> and call:
          </p>
          <div className="mt-3 space-y-1 font-mono text-xs bg-muted rounded-lg p-3">
            <p><span className="text-green-600">POST</span> /api/v1/agents/:slug/sessions — Create session + send message</p>
            <p><span className="text-green-600">POST</span> /api/v1/agents/:slug/sessions/:id/messages — Follow-up message</p>
            <p><span className="text-blue-600">GET</span>&nbsp; /api/v1/agents/:slug/sessions/:id/messages — Get history</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

