"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Users, Search } from "lucide-react";
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

interface User { id: string; email: string; name: string; role: string; profileId: string | null; isLocked: boolean; lastLoginAt: string | null; createdAt: string; }

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/users?${params}`);
    if (res.ok) { const d = await res.json(); setUsers(d.data); setTotal(d.total); setTotalPages(d.totalPages); }
    setLoading(false);
  }, [page, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  return (
    <>
      <PageHeader title="Users" description="Manage user accounts and permissions.">
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Add User</Button>
      </PageHeader>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
        </div>
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
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableSkeleton columns={5} /> : users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell><Badge variant="secondary">{u.role.replace("_", " ")}</Badge></TableCell>
                  <TableCell>{u.isLocked ? <Badge variant="error">Locked</Badge> : <Badge variant="success">Active</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination page={page} pageSize={20} total={total} totalPages={totalPages} onPageChange={setPage} />

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <CreateUserForm onCreated={() => { setShowCreate(false); fetchUsers(); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "member" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSubmitting(true);
    const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) onCreated();
    else { const d = await res.json(); setError(d.error || "Failed"); }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
      <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></div>
      <div className="space-y-2"><Label>Password</Label><Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required minLength={8} /></div>
      <div className="space-y-2"><Label>Role</Label>
        <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
          <option value="viewer">Viewer</option><option value="member">Member</option><option value="admin">Admin</option><option value="super_admin">Super Admin</option>
        </Select>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Creating..." : "Create"}</Button>
    </form>
  );
}
