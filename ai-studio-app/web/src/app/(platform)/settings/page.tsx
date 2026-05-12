"use client";
import { RequirePermission } from "@/components/require-permission";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Pagination } from "@/components/pagination";

interface SystemConfig { id: string; key: string; value: Record<string, unknown>; updatedAt: string; }
interface Profile { id: string; name: string; description: string; accessRights: Record<string, number>; isSystem: boolean; }
interface AuditEntry { id: number; action: string; resourceType: string | null; createdAt: string; }

export default function SettingsPage() {
  const [tab, setTab] = useState("general");
  return (
    <RequirePermission module="SETTINGS"><>
      <PageHeader title="Settings" description="Configure platform settings, profiles, and account preferences." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab /></TabsContent>
        <TabsContent value="profiles"><ProfilesTab /></TabsContent>
        <TabsContent value="account"><AccountTab /></TabsContent>
        <TabsContent value="audit"><AuditLogTab /></TabsContent>
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

const MODULES = ["DASHBOARD", "AGENTS", "TOOLS", "KNOWLEDGE", "WORKFLOWS", "CONNECTORS", "RUNS", "PROVIDERS", "USERS", "PROFILES", "AUDIT", "SETTINGS"] as const;
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
    Object.fromEntries(MODULES.map((m) => [m, 0]))
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
      setCreateRights(Object.fromEntries(MODULES.map((m) => [m, 0])));
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
                    {MODULES.map((m) => (
                      <th key={m} className="px-2 py-1 text-center font-medium text-muted-foreground">{m.slice(0, 6)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {MODULES.map((m) => {
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
                {MODULES.map((m) => (
                  <TableHead key={m} className="text-center text-[10px] min-w-[52px] px-1">{m.slice(0, 6)}</TableHead>
                ))}
                <TableHead className="text-center min-w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={MODULES.length + 2} rows={4} /> : profiles.map((p) => {
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
                    {MODULES.map((m) => {
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

function AccountTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault(); setMessage(""); setSubmitting(true);
    const me = await fetch("/api/auth/me").then((r) => r.json());
    const userId = me?.user?.id;
    if (!userId) { setMessage("Could not determine user ID"); setSubmitting(false); return; }
    const res = await fetch(`/api/users/${userId}/password`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
    const data = await res.json();
    setMessage(res.ok ? "Password changed successfully." : (data.error || "Failed"));
    setSubmitting(false);
    if (res.ok) { setCurrentPassword(""); setNewPassword(""); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
      <CardContent>
        {message && <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${message.includes("success") ? "bg-green-50 text-green-700 border border-green-200" : "bg-destructive/5 text-destructive border border-destructive/20"}`}>{message}</div>}
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div className="space-y-2"><Label>Current Password</Label><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></div>
          <div className="space-y-2"><Label>New Password</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></div>
          <Button type="submit" disabled={submitting}>{submitting ? "Changing..." : "Change Password"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const fetchAudit = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/audit-log?page=${page}&pageSize=20`);
    if (res.ok) { const d = await res.json(); setEntries(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page]);
  useEffect(() => { fetchAudit(); }, [fetchAudit]);
  return (
    <>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Resource</TableHead><TableHead>Timestamp</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading ? <TableSkeleton columns={3} rows={10} /> : entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium font-mono text-xs">{e.action}</TableCell>
                <TableCell className="text-muted-foreground">{e.resourceType || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pagination page={page} pageSize={20} total={total} totalPages={totalPages} onPageChange={setPage} />
    </>
  );
}
