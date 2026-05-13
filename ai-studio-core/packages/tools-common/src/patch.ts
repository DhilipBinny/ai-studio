import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import { resolveTenantPath, getAgentWorkspacePath } from "./workspace";
import type { BuiltinToolContext } from "./types";

const EXEC_TIMEOUT_MS = 30_000;

interface GitApplyResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  killed: boolean;
}

function gitApply(cwd: string, patch: string, extraArgs: string[]): Promise<GitApplyResult> {
  return new Promise((resolve) => {
    const child = spawn("git", ["apply", ...extraArgs], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, EXEC_TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    (child as unknown as NodeJS.EventEmitter).on("error", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + "\n[spawn error]", exitCode: 1, killed });
    });
    (child as unknown as NodeJS.EventEmitter).on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1, killed });
    });

    try {
      child.stdin.write(patch);
      child.stdin.end();
    } catch {
      /* child already closed stdin */
    }
  });
}

export function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();
  const lines = patch.split("\n");
  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if (line.startsWith("+++ ") && (m = line.match(/^\+\+\+ (?:b\/)?(.+?)(?:\t|$)/))) {
      const p = m[1].trim();
      if (p && p !== "/dev/null") paths.add(p);
    } else if (line.startsWith("--- ") && (m = line.match(/^--- (?:a\/)?(.+?)(?:\t|$)/))) {
      const p = m[1].trim();
      if (p && p !== "/dev/null") paths.add(p);
    } else if (line.startsWith("diff --git ")) {
      const m2 = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (m2) {
        paths.add(m2[1].trim());
        paths.add(m2[2].trim());
      }
    }
  }
  return Array.from(paths);
}

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

export const patchTools: ToolRegistration[] = [
  {
    definition: {
      name: "apply_patch",
      description:
        "Apply a unified diff (git patch) atomically via `git apply`. " +
        "Validates with `git apply --check` first so invalid patches " +
        "never touch disk. The working directory defaults to the agent workspace.",
      parameters: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description: "Full unified diff text (including diff --git headers, @@ hunks, etc.)",
          },
          dry_run: {
            type: "boolean",
            description: "If true, only validates the patch without applying. Default false.",
          },
        },
        required: ["patch"],
      },
    },
    executor: async (args, context) => {
      const patch = args.patch as string;
      if (!patch || typeof patch !== "string") {
        return { error: "patch is required and must be a string" };
      }

      const ctx = getCtx(context as Record<string, unknown>);
      const cwd = getAgentWorkspacePath(ctx.workspace);

      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
      }

      const touchedPaths = extractPatchPaths(patch);
      for (const p of touchedPaths) {
        const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
        if (!abs.startsWith(cwd + path.sep) && abs !== cwd) {
          return { error: `Patch rejected — file "${p}" resolves outside workspace.` };
        }
      }

      const check = await gitApply(cwd, patch, ["--check", "--verbose"]);
      if (check.killed) {
        return { error: "git apply --check timed out (30s)" };
      }
      if (check.exitCode !== 0) {
        return {
          error:
            `Patch validation failed (git apply --check exit ${check.exitCode}):\n` +
            (check.stderr || check.stdout || "(no output)"),
        };
      }

      const dryRun = args.dry_run === true;
      if (dryRun) {
        return textEnvelope(
          `git apply --check OK (dry run).\n\n` +
          `Patch would touch ${touchedPaths.length} file${touchedPaths.length === 1 ? "" : "s"}:\n` +
          touchedPaths.map((p) => `  ${p}`).join("\n"),
        );
      }

      const apply = await gitApply(cwd, patch, ["--verbose"]);
      if (apply.killed) {
        return { error: "git apply timed out (30s)" };
      }
      if (apply.exitCode !== 0) {
        return {
          error:
            `git apply failed (exit ${apply.exitCode}):\n` +
            (apply.stderr || apply.stdout || "(no output)"),
        };
      }

      return textEnvelope(
        `Applied patch to ${touchedPaths.length} file${touchedPaths.length === 1 ? "" : "s"}.\n\n` +
        `Touched files:\n` +
        touchedPaths.map((p) => `  ${p}`).join("\n"),
      );
    },
    source: "builtin",
    category: "write",
    isDestructive: true,
    maxResultSizeChars: 64 * 1024,
  },
];
