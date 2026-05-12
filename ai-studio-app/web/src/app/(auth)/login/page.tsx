"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginState = "credentials" | "otp" | "loading";

export default function LoginPage() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [etus, setEtus] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  function validateEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});

    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = "Email is required";
    else if (!validateEmail(email)) errors.email = "Please enter a valid email address";
    if (!password) errors.password = "Password is required";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setError("");
    setState("loading");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); setState("credentials"); return; }
      if (data.requires_otp) { setEtus(data.etus); setState("otp"); return; }
      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
      setState("credentials");
    }
  }

  async function handleOTPVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("loading");

    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etus, otp }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Verification failed"); setState("otp"); return; }
      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
      setState("otp");
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 md:p-10">
      <div className="w-full max-w-[420px] space-y-8">
        <div className="flex flex-col items-center space-y-3 text-center">
          <img src="/branding/echollogo.png" alt="Echol" className="h-14 w-auto" />
          <h1 className="text-2xl font-semibold tracking-tight text-brand">Echol AI Studio</h1>
          {state === "otp" && (
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code sent to your email
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_0_1px_rgba(0,0,0,0.1)]">
          {error && (
            <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {state !== "otp" ? (
            <form onSubmit={handleLogin} noValidate className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="text"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setFieldErrors((p) => ({ ...p, email: undefined })); }}
                  placeholder="you@echoltech.com"
                  autoComplete="username"
                  autoFocus
                  className={`h-11 px-4 text-sm focus-visible:ring-brand/30 ${fieldErrors.email ? "border-destructive focus-visible:ring-destructive/30" : "border-slate-300"}`}
                />
                {fieldErrors.email && (
                  <p className="text-xs text-destructive">{fieldErrors.email}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFieldErrors((p) => ({ ...p, password: undefined })); }}
                  autoComplete="current-password"
                  className={`h-11 px-4 text-sm focus-visible:ring-brand/30 ${fieldErrors.password ? "border-destructive focus-visible:ring-destructive/30" : "border-slate-300"}`}
                />
                {fieldErrors.password && (
                  <p className="text-xs text-destructive">{fieldErrors.password}</p>
                )}
              </div>
              <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={state === "loading"}>
                {state === "loading" && (
                  <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {state === "loading" ? "Signing in..." : "Sign in"}
              </Button>
              <div className="text-center">
                <button type="button" className="text-xs text-muted-foreground hover:text-brand transition-colors">
                  Forgot password?
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleOTPVerify} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  required
                  className="h-11 border-slate-300 text-center text-2xl tracking-[0.5em] font-mono focus-visible:ring-brand/30"
                  placeholder="000000"
                  autoFocus
                />
              </div>
              <Button type="submit" className="h-11 w-full text-sm font-medium" disabled={otp.length !== 6}>
                Verify
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full"
                onClick={() => { setState("credentials"); setOtp(""); setError(""); }}
              >
                Back to login
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/50">
          &copy; {new Date().getFullYear()} Echol Technology. All rights reserved.
        </p>
      </div>
    </div>
  );
}
