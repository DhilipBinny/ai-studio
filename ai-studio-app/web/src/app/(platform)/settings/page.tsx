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

function ProfilesTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/profiles").then((r) => r.ok ? r.json() : null).then((d) => { setProfiles(d?.data || []); setLoading(false); });
  }, []);
  const modules = ["DASHBOARD", "AGENTS", "TOOLS", "KNOWLEDGE", "WORKFLOWS", "CONNECTORS", "RUNS", "PROVIDERS", "USERS", "PROFILES", "AUDIT", "SETTINGS"];
  const levelLabel = (v: number) => v === 20 ? "Full" : v === 10 ? "View" : "None";
  const levelVariant = (v: number): "success" | "warning" | "secondary" => v === 20 ? "success" : v === 10 ? "warning" : "secondary";
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Access Profiles</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <Table>
            <TableHeader><TableRow><TableHead className="min-w-[120px]">Profile</TableHead>{modules.map((m) => <TableHead key={m} className="text-center text-xs min-w-[60px]">{m.slice(0, 5)}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={modules.length + 1} rows={4} /> : profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><div className="flex items-center gap-2"><span className="font-medium">{p.name}</span>{p.isSystem && <Badge variant="outline">System</Badge>}</div></TableCell>
                  {modules.map((m) => { const val = (p.accessRights as Record<string, number>)[m] ?? 0; return <TableCell key={m} className="text-center"><Badge variant={levelVariant(val)}>{levelLabel(val)}</Badge></TableCell>; })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
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
