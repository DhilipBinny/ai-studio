"use client";
import { RequirePermission } from "@/components/require-permission";
import { DEFAULT_PAGE_SIZE } from "@/lib/client-config";

import { useState, useEffect, useCallback } from "react";
import { Plus, Users, Search, Pencil, Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";

interface User { id: string; email: string; name: string; role: string; profileId: string | null; profileName: string | null; isActive: boolean; isLocked: boolean; lastLoginAt: string | null; createdAt: string; }

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [showAll, setShowAll] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
    if (search) params.set("search", search);
    if (showAll) params.set("showAll", "true");
    const res = await fetch(`/api/users?${params}`);
    if (res.ok) { const d = await res.json(); setUsers(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page, search, showAll]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  return (
    <RequirePermission module="USERS"><>
      <PageHeader title="Users" description="Manage user accounts and permissions.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Add User</Button>
      </PageHeader>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setPage(1); }} className="accent-brand" />
          Show inactive
        </label>
      </div>

      {!loading && users.length === 0 ? (
        <EmptyState icon={Users} title="No users found" description={search ? "Try a different search term." : "Add your first user to get started."} actionLabel={search ? undefined : "Add User"} onAction={search ? undefined : () => setShowCreate(true)} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={7} /> : users.map((u) => (
                <TableRow key={u.id} className={!u.isActive ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{u.name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell><Badge variant="secondary">{u.role.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{u.profileName || "—"}</TableCell>
                  <TableCell>
                    {!u.isActive ? <Badge variant="secondary">Inactive</Badge> : u.isLocked ? <Badge variant="error">Locked</Badge> : <Badge variant="success">Active</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}</TableCell>
                  <TableCell>
                    {u.isActive ? (
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditUser(u)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={async () => {
                        await fetch(`/api/users/${u.id}/reactivate`, { method: "POST" });
                        fetchUsers();
                      }}>
                        Reactivate
                      </Button>
                    )}
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
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <CreateUserForm onCreated={() => { setShowCreate(false); fetchUsers(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }} size="xl">
        <DialogContent onClose={() => setEditUser(null)}>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          {editUser && <EditUserForm user={editUser} onSaved={() => { setEditUser(null); fetchUsers(); }} />}
        </DialogContent>
      </Dialog>
    </></RequirePermission>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "member", profileId: "" });
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/profiles")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d?.data || d || [];
        if (Array.isArray(list)) setProfiles(list);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSubmitting(true);
    const body: Record<string, unknown> = { ...form };
    if (!form.profileId) delete body.profileId;
    const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) onCreated();
    else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
      <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></div>
      <PasswordInput
        value={form.password}
        onChange={(v) => setForm((f) => ({ ...f, password: v }))}
        userInputs={[form.email, form.name].filter(Boolean)}
      />
      <div className="space-y-2"><Label>Role</Label>
        <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
          <option value="viewer">Viewer</option><option value="member">Member</option><option value="admin">Admin</option><option value="super_admin">Super Admin</option>
        </Select>
      </div>
      <div className="space-y-2"><Label>Profile <span className="text-destructive">*</span></Label>
        <Select value={form.profileId} onChange={(e) => setForm((f) => ({ ...f, profileId: e.target.value }))} required>
          <option value="">Select a profile...</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">Determines what the user can access.</p>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
    </form>
  );
}

function EditUserForm({ user, onSaved }: { user: User; onSaved: () => void }) {
  const [form, setForm] = useState({ name: user.name, role: user.role, profileId: user.profileId || "" });
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    fetch("/api/profiles")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d?.data || d || [];
        if (Array.isArray(list)) setProfiles(list);
      })
      .catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    const body: Record<string, unknown> = {};
    if (form.name !== user.name) body.name = form.name;
    if (form.role !== user.role) body.role = form.role;
    if (form.profileId !== (user.profileId || "")) body.profileId = form.profileId || null;

    if (Object.keys(body).length === 0) {
      setMessage("No changes to save.");
      setSubmitting(false);
      return;
    }

    const res = await fetch(`/api/users/${user.id}`, {
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

  async function handleDeactivate() {
    setDeactivating(true);
    const res = await fetch(`/api/users/${user.id}/deactivate`, { method: "POST" });
    if (res.ok) {
      onSaved();
    } else {
      const d = await res.json();
      setError(d.error || "Failed to deactivate");
    }
    setDeactivating(false);
    setConfirmDeactivate(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      {message && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div>}

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>

      <div className="space-y-2">
        <Label>Name</Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      </div>

      <div className="space-y-2">
        <Label>Role</Label>
        <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
          <option value="viewer">Viewer</option>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Profile</Label>
        <Select value={form.profileId} onChange={(e) => setForm((f) => ({ ...f, profileId: e.target.value }))}>
          <option value="">No profile</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
        </Button>
        {!confirmDeactivate ? (
          <Button type="button" variant="outline" onClick={() => setConfirmDeactivate(true)}>
            Deactivate
          </Button>
        ) : (
          <Button type="button" variant="destructive" onClick={handleDeactivate} disabled={deactivating}>
            {deactivating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Deactivate"}
          </Button>
        )}
      </div>
    </form>
  );
}
