"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/password-input";
import { Loader2, CheckCircle } from "lucide-react";
import { BRAND } from "@/lib/branding";
import { AuthBackground } from "../auth-background";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="relative flex min-h-svh items-center justify-center">
        <AuthBackground />
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground relative z-10" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || password.length < 12) return;
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const d = await res.json();
        setError(d.error || "Failed to reset password");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  if (!token) {
    return (
      <div className="relative flex min-h-svh flex-col items-center justify-center p-6">
        <AuthBackground />
        <div className="relative z-10 rounded-xl border border-slate-200 bg-white/90 backdrop-blur-sm p-8 shadow-md text-center max-w-sm">
          <p className="text-sm text-destructive">Invalid reset link. No token provided.</p>
          <a href="/login" className="mt-4 inline-block text-xs text-brand hover:underline">Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-[420px] space-y-8">
        <div className="flex flex-col items-center space-y-3 text-center">
          <img src={BRAND.logo} alt={BRAND.logoAlt} className="h-14 w-auto" />
          <h1 className="text-2xl font-semibold tracking-tight text-brand">
            {submitted ? "Password reset" : "Set new password"}
          </h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white/90 backdrop-blur-sm p-8 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_0_1px_rgba(0,0,0,0.1)]">
          {submitted ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground">Your password has been reset successfully.</p>
              <a href="/login" className="inline-block">
                <Button className="h-11 w-full text-sm font-medium">Sign in with new password</Button>
              </a>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <PasswordInput value={password} onChange={setPassword} label="New Password" />
                <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={submitting || password.length < 12}>
                  {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting...</> : "Reset password"}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/50">
          {BRAND.copyright(new Date().getFullYear())}
        </p>
      </div>
    </div>
  );
}
