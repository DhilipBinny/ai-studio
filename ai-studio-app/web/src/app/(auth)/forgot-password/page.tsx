"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Mail } from "lucide-react";
import { BRAND } from "@/lib/branding";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/password/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const d = await res.json();
        setError(d.error || "Failed to send reset email");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 md:p-10">
      <div className="w-full max-w-[420px] space-y-8">
        <div className="flex flex-col items-center space-y-3 text-center">
          <img src={BRAND.logo} alt={BRAND.logoAlt} className="h-14 w-auto" />
          <h1 className="text-2xl font-semibold tracking-tight text-brand">
            {submitted ? "Check your email" : "Reset password"}
          </h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_0_1px_rgba(0,0,0,0.1)]">
          {submitted ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                <Mail className="h-6 w-6 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong>{email}</strong>, we've sent a password reset link. Check your inbox.
              </p>
              <p className="text-xs text-muted-foreground">The link expires in 30 minutes.</p>
              <a href="/login" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                <ArrowLeft className="h-3 w-3" /> Back to login
              </a>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <p className="mb-4 text-sm text-muted-foreground">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={BRAND.emailPlaceholder}
                    required
                    autoFocus
                    className="h-11 border-slate-300 px-4 text-sm focus-visible:ring-brand/30"
                  />
                </div>
                <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={submitting}>
                  {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : "Send reset link"}
                </Button>
              </form>
              <div className="mt-4 text-center">
                <a href="/login" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-brand transition-colors">
                  <ArrowLeft className="h-3 w-3" /> Back to login
                </a>
              </div>
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
