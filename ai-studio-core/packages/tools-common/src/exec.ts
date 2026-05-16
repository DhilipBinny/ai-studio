import { EXEC_MAX_STDOUT, EXEC_MAX_STDERR, EXEC_MAX_TIMEOUT_SECONDS, EXEC_DEFAULT_TIMEOUT_SECONDS } from "./constants";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { getTempPath, getProjectWorkspacePath } from "./workspace";
import type { BuiltinToolContext } from "./types";
import fs from "node:fs";

const execFileAsync = promisify(execFileCb);

export function formatExecResult(stdout: string, stderr: string, exitCode: number): string {
  const lines: string[] = [`exit code: ${exitCode}`];
  if (stdout) lines.push("", "stdout:", stdout);
  if (stderr) lines.push("", "stderr:", stderr);
  return lines.join("\n");
}

const SAFE_ENV_KEYS = [
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE",
  "NODE_ENV", "TZ", "TMPDIR", "COLORTERM",
];

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*-.*r.*-.*f|.*-.*f.*-.*r)\s*\//i, reason: "rm -rf on root path" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/(?!\w)/i, reason: "recursive delete on root" },
  { pattern: /\bmkfs\b/i, reason: "format filesystem" },
  { pattern: /\bdd\b.*\bof\s*=\s*\/dev\//i, reason: "write to disk device" },
  { pattern: /\b>\s*\/dev\/[sh]d/i, reason: "redirect to disk device" },
  { pattern: /\bshutdown\b/i, reason: "system shutdown" },
  { pattern: /\breboot\b/i, reason: "system reboot" },
  { pattern: /\binit\s+[06]\b/i, reason: "init runlevel change" },
  { pattern: /\bkill\s+-9\s+1\b/i, reason: "kill init process" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh/i, reason: "curl pipe to shell" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh/i, reason: "wget pipe to shell" },
  { pattern: /\bLD_PRELOAD\s*=/i, reason: "LD_PRELOAD injection" },
  { pattern: /\bDYLD_/i, reason: "DYLD injection" },
  { pattern: /\bLD_LIBRARY_PATH\s*=/i, reason: "LD_LIBRARY_PATH hijacking" },
  { pattern: /\bcat\b.*\/(\.ssh\/|\.aws\/|\.env\b|secrets\.json|\.docker\/config)/i, reason: "read credential files" },
  { pattern: /\b(history|\.bash_history|\.zsh_history)\b/i, reason: "read shell history" },
  { pattern: /\bsystemctl\s+(stop|disable|mask)\s+(docker|sshd|network|firewall)/i, reason: "disable critical service" },
  { pattern: /\bgit\s+push\s+--force\b/i, reason: "git force push" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "git hard reset" },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/i, reason: "git clean forced" },
  { pattern: /\bgit\s+branch\s+-D\s+(main|master)\b/i, reason: "delete main branch" },
];

function checkCommandSafety(command: string): { blocked: boolean; reason?: string } {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return { blocked: true, reason };
  }
  return { blocked: false };
}

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

export const execTools: ToolRegistration[] = [
  {
    definition: {
      name: "exec_command",
      description: "Execute a shell command in the agent's temp workspace. Returns stdout, stderr, and exit code.",
      alwaysLoad: true,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in seconds (default: 30, max: 120)" },
        },
        required: ["command"],
      },
    },
    executor: async (args, context) => {
      const command = args.command as string;
      if (!command || typeof command !== "string") {
        return { error: "command is required and must be a string" };
      }
      if (command.length > 10000) {
        return { error: "Command too long (max 10000 chars)" };
      }

      const safety = checkCommandSafety(command);
      if (safety.blocked) {
        return { error: `Blocked: ${safety.reason}. This command is too dangerous to execute.` };
      }

      const ctx = getCtx(context as Record<string, unknown>);
      const projectPath = getProjectWorkspacePath(ctx.workspace);
      const cwd = projectPath || getTempPath(ctx.workspace);
      fs.mkdirSync(cwd, { recursive: true });

      const agentMaxTimeout = ctx.workspace.execTimeoutMs ? ctx.workspace.execTimeoutMs / 1000 : EXEC_MAX_TIMEOUT_SECONDS;
      const maxAllowed = Math.min(agentMaxTimeout, EXEC_MAX_TIMEOUT_SECONDS);
      const timeout = Math.min(Math.max(Number(args.timeout) || EXEC_DEFAULT_TIMEOUT_SECONDS, 1), maxAllowed) * 1000;

      const safeEnv: Record<string, string> = {};
      for (const key of SAFE_ENV_KEYS) {
        if (process.env[key]) safeEnv[key] = process.env[key]!;
      }

      try {
        const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
          cwd,
          timeout,
          maxBuffer: 1024 * 1024,
          env: safeEnv as NodeJS.ProcessEnv,
        });
        return textEnvelope(formatExecResult(
          stdout.slice(0, EXEC_MAX_STDOUT),
          stderr.slice(0, EXEC_MAX_STDERR),
          0,
        ));
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string; code?: unknown; status?: number };
        return textEnvelope(formatExecResult(
          (err.stdout || "").slice(0, EXEC_MAX_STDOUT),
          (err.stderr || err.message || "").slice(0, EXEC_MAX_STDERR),
          err.status || (typeof err.code === "number" ? err.code : 1),
        ));
      }
    },
    source: "builtin",
    category: "execute",
    isDestructive: true,
    maxResultSizeChars: 128 * 1024,
  },
  {
    definition: {
      name: "batch_exec",
      description:
        "Run multiple shell commands in parallel. Much faster than sequential exec_command calls. Max 10 commands per batch.",
      parameters: {
        type: "object",
        properties: {
          commands: {
            type: "array",
            items: { type: "string" },
            description: "Array of shell commands to run in parallel (max 10)",
          },
          timeout: {
            type: "number",
            description: "Timeout in seconds per command (default 30, max 120)",
          },
        },
        required: ["commands"],
      },
    },
    validateInput: (input) => {
      const args = input as Record<string, unknown>;
      if (!Array.isArray(args.commands) || args.commands.length === 0) {
        return { ok: false, error: "commands must be a non-empty array of strings." };
      }
      if (args.commands.length > 10) {
        return { ok: false, error: "Maximum 10 commands per batch." };
      }
      for (const cmd of args.commands) {
        if (typeof cmd !== "string" || cmd.trim().length === 0) {
          return { ok: false, error: "Each command must be a non-empty string." };
        }
      }
      return { ok: true };
    },
    executor: async (args, context) => {
      const commands = args.commands as string[];
      const timeout = Math.min(Math.max(Number(args.timeout) || 30, 1), EXEC_MAX_TIMEOUT_SECONDS) * 1000;

      for (const cmd of commands) {
        if (cmd.length > 10000) {
          return { error: `Command too long (max 10000 chars): "${cmd.slice(0, 60)}..."` };
        }
        const safety = checkCommandSafety(cmd);
        if (safety.blocked) {
          return { error: `Blocked command in batch: "${cmd.slice(0, 100)}". Reason: ${safety.reason}` };
        }
      }

      const ctx = getCtx(context as Record<string, unknown>);
      const batchProjectPath = getProjectWorkspacePath(ctx.workspace);
      const cwd = batchProjectPath || getTempPath(ctx.workspace);
      fs.mkdirSync(cwd, { recursive: true });

      const safeEnv: Record<string, string> = {};
      for (const key of SAFE_ENV_KEYS) {
        if (process.env[key]) safeEnv[key] = process.env[key]!;
      }

      const startTime = Date.now();
      const results = await Promise.allSettled(
        commands.map(async (cmd) => {
          try {
            const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", cmd], {
              cwd, timeout, maxBuffer: 1024 * 1024, env: safeEnv as NodeJS.ProcessEnv,
            });
            return { exitCode: 0, stdout: (stdout || "").slice(0, EXEC_MAX_STDOUT), stderr: (stderr || "").slice(0, EXEC_MAX_STDERR) };
          } catch (e: unknown) {
            const err = e as { stdout?: string; stderr?: string; code?: number; status?: number; signal?: string };
            return {
              exitCode: err.status ?? (typeof err.code === "number" ? err.code : 1),
              stdout: (err.stdout || "").slice(0, EXEC_MAX_STDOUT),
              stderr: (err.stderr || "").slice(0, EXEC_MAX_STDERR),
            };
          }
        }),
      );

      const elapsed = Date.now() - startTime;
      const output: string[] = [`Batch: ${commands.length} commands in ${elapsed}ms (parallel)\n`];
      for (let i = 0; i < results.length; i++) {
        output.push(`--- [${i + 1}] ${commands[i].slice(0, 80)} ---`);
        if (results[i].status === "fulfilled") {
          const r = (results[i] as PromiseFulfilledResult<{ exitCode: number; stdout: string; stderr: string }>).value;
          output.push(formatExecResult(r.stdout, r.stderr, r.exitCode));
        } else {
          output.push(`error: ${(results[i] as PromiseRejectedResult).reason}`);
        }
        output.push("");
      }

      return textEnvelope(output.join("\n"));
    },
    source: "builtin",
    category: "execute",
    isDestructive: true,
    concurrencySafe: true,
  },
];
