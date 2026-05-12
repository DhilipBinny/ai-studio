"use client";
import { RequirePermission } from "@/components/require-permission";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="profiles"><ProfilesTab /></TabsContent>
      </Tabs>
    </></RequirePermission>
  );
}

function GeneralTab() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/settings").then((r) => r.ok ? r.json() : null).then((d) => { setConfigs(d?.data || []); setLoading(false); });
  }, []);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">System Configuration</CardTitle></CardHeader>
      <CardContent>
        {loading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div> : configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No configuration entries.</p>
        ) : (
          <div className="space-y-4">{configs.map((c) => (
            <div key={c.id} className="flex items-start justify-between border-b border-border pb-3 last:border-0">
              <div><p className="text-sm font-medium">{c.key}</p><pre className="mt-1 text-xs text-muted-foreground max-w-lg overflow-auto">{JSON.stringify(c.value, null, 2)}</pre></div>
              <span className="text-xs text-muted-foreground shrink-0">{new Date(c.updatedAt).toLocaleDateString()}</span>
            </div>
          ))}</div>
        )}
      </CardContent>
    </Card>
  );
}

import { MODULES } from "@ais-app/types";
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

  async function handleDelete(profileId: string, profileName: string) {
    if (!confirm(`Delete profile "${profileName}"? Users with this profile will lose their permissions.`)) return;
    const res = await fetch(`/api/profiles/${profileId}`, { method: "DELETE" });
    if (res.ok) {
      setMessage({ text: "Profile deleted", ok: true });
      fetchProfiles();
    } else {
      const d = await res.json();
      setMessage({ text: d.error || "Failed to delete", ok: false });
    }
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
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground" onClick={() => handleDelete(p.id, p.name)}>Delete</Button>
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
    </div>
  );
}

