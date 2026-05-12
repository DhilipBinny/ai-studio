"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LogOut, User, KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PasswordInput } from "@/components/password-input";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export function AppHeader() {
  const { user } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
        <div />

        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setDropdownOpen((o) => !o); }}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-brand">
              <User className="h-4 w-4" />
            </div>
            {user && (
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role] || user.role}</p>
              </div>
            )}
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-card p-1 shadow-md">
                {user && (
                  <div className="px-3 py-2">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                )}
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => { setDropdownOpen(false); setShowPasswordDialog(true); }}
                >
                  <KeyRound className="h-4 w-4" />
                  Change Password
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </Button>
              </div>
            </>
          )}
        </div>
      </header>

      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent onClose={() => setShowPasswordDialog(false)}>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
          </DialogHeader>
          <ChangePasswordForm onDone={() => setShowPasswordDialog(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);

    if (!user) { setMessage({ text: "Not logged in", ok: false }); setSubmitting(false); return; }

    if (newPassword.length < 12) {
      setMessage({ text: "Password must be at least 12 characters", ok: false });
      setSubmitting(false);
      return;
    }

    const res = await fetch(`/api/users/${user.id}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();

    if (res.ok) {
      setMessage({ text: "Password changed. You'll need to log in again.", ok: true });
      setCurrentPassword("");
      setNewPassword("");
      setTimeout(() => { window.location.href = "/login"; }, 2000);
    } else {
      setMessage({ text: data.error || "Failed to change password", ok: false });
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {message && (
        <div className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-destructive/5 text-destructive border border-destructive/20"}`}>
          {message.text}
        </div>
      )}
      <div className="space-y-2">
        <Label>Current Password</Label>
        <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      </div>
      <PasswordInput
        value={newPassword}
        onChange={setNewPassword}
        label="New Password"
        userInputs={user ? [user.email, user.name] : []}
      />
      <Button type="submit" className="w-full" disabled={submitting || newPassword.length < 12}>
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Changing...</> : "Change Password"}
      </Button>
    </form>
  );
}
