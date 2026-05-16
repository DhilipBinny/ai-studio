"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, X, Loader2, Eye, EyeOff } from "lucide-react";
import { PASSWORD_CONFIG, HIBP_API_URL } from "@/lib/client-config";

type ZxcvbnFn = (password: string, userInputs?: (string | number)[]) => { score: number; feedback: { warning: string | null; suggestions: string[] } };

let zxcvbnFn: ZxcvbnFn | null = null;
let zxcvbnLoading = false;
const zxcvbnWaiters: Array<() => void> = [];

async function loadZxcvbn(): Promise<ZxcvbnFn> {
  if (zxcvbnFn) return zxcvbnFn;
  if (zxcvbnLoading) {
    return new Promise((resolve) => {
      zxcvbnWaiters.push(() => resolve(zxcvbnFn!));
    });
  }
  zxcvbnLoading = true;
  const [{ zxcvbn, zxcvbnOptions }, common, en] = await Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]);
  zxcvbnOptions.setOptions({
    translations: en.translations,
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary },
  });
  zxcvbnFn = zxcvbn;
  zxcvbnWaiters.forEach((fn) => fn());
  zxcvbnWaiters.length = 0;
  return zxcvbn;
}

const MIN_LENGTH = PASSWORD_CONFIG.minLength;
const MIN_STRENGTH = PASSWORD_CONFIG.minStrength;

const STRENGTH_LABELS = ["Weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-green-500", "bg-emerald-500"];

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  userInputs?: string[];
  required?: boolean;
}

export function PasswordInput({ value, onChange, label = "Password", userInputs = [], required = true }: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [breachStatus, setBreachStatus] = useState<"idle" | "checking" | "safe" | "breached">("idle");
  const [breachCount, setBreachCount] = useState(0);
  const [score, setScore] = useState(0);
  const [warning, setWarning] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [zxcvbnReady, setZxcvbnReady] = useState(false);
  const analyzeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (value.length === 0) {
      setScore(0);
      setWarning("");
      setSuggestions([]);
      return;
    }
    clearTimeout(analyzeTimer.current);
    analyzeTimer.current = setTimeout(async () => {
      const fn = await loadZxcvbn();
      if (!zxcvbnReady) setZxcvbnReady(true);
      const result = fn(value, userInputs);
      setScore(result.score);
      setWarning(result.feedback.warning || "");
      setSuggestions(result.feedback.suggestions);
    }, 150);
    return () => clearTimeout(analyzeTimer.current);
  }, [value, userInputs, zxcvbnReady]);

  const meetsLength = value.length >= MIN_LENGTH;
  const meetsStrength = score >= MIN_STRENGTH;

  const checkBreach = useCallback(async (pw: string) => {
    if (pw.length < MIN_LENGTH) return;
    setBreachStatus("checking");
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(pw);
      const hashBuffer = await crypto.subtle.digest("SHA-1", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const sha1 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);

      const res = await fetch(`${HIBP_API_URL}/${prefix}`);
      if (!res.ok) { setBreachStatus("safe"); return; }
      const text = await res.text();
      for (const line of text.split("\n")) {
        const [hash, countStr] = line.trim().split(":");
        if (hash === suffix) {
          const count = parseInt(countStr, 10);
          if (count > 0) {
            setBreachStatus("breached");
            setBreachCount(count);
            return;
          }
        }
      }
      setBreachStatus("safe");
    } catch {
      setBreachStatus("safe");
    }
  }, []);

  const shouldCheckBreach = touched && value.length >= MIN_LENGTH;

  useEffect(() => {
    if (!shouldCheckBreach) return;
    const timer = setTimeout(() => checkBreach(value), 800);
    return () => clearTimeout(timer);
  }, [value, shouldCheckBreach, checkBreach]);

  return (
    <div className="space-y-2">
      <Label htmlFor="password-input">{label} {required && <span className="text-destructive">*</span>}</Label>
      <div className="relative">
        <Input
          id="password-input"
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(e) => { onChange(e.target.value); if (!touched) setTouched(true); }}
          onBlur={() => setTouched(true)}
          required={required}
          className="pr-10"
          aria-describedby="password-feedback"
        />
        <button
          type="button"
          onClick={() => setShowPassword((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          tabIndex={-1}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {value.length > 0 && (
        <div id="password-feedback" className="space-y-2" aria-live="polite">
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i < score ? STRENGTH_COLORS[score] : "bg-muted"
                }`}
              />
            ))}
          </div>
          <p className={`text-xs font-medium ${score >= 3 ? "text-green-600" : score >= 2 ? "text-amber-600" : "text-red-600"}`}>
            {STRENGTH_LABELS[score]}
          </p>

          <div className="space-y-1">
            <Requirement met={meetsLength} text={`At least ${MIN_LENGTH} characters`} />
            {meetsLength && <Requirement met={meetsStrength} text="Good or Strong strength" />}
            {shouldCheckBreach && breachStatus === "checking" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking breach database...
              </div>
            )}
            {shouldCheckBreach && breachStatus === "safe" && <Requirement met={true} text="Not found in breach databases" />}
            {shouldCheckBreach && breachStatus === "breached" && (
              <div className="flex items-center gap-1.5 text-xs text-red-600">
                <X className="h-3 w-3" /> Found in {breachCount.toLocaleString()} data breaches — choose a different password
              </div>
            )}
          </div>

          {warning && (
            <p className="text-xs text-amber-600">{warning}</p>
          )}
          {suggestions.length > 0 && (
            <div className="space-y-0.5">
              {suggestions.map((s, i) => (
                <p key={i} className="text-xs text-muted-foreground">{s}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Requirement({ met, text }: { met: boolean; text: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs ${met ? "text-green-600" : "text-muted-foreground"}`}>
      {met ? <Check className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />}
      {text}
    </div>
  );
}
