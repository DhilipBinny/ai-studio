import { spawn } from 'node:child_process';
import type { AgwLogger } from '@ais/types';
import { noopLogger } from '@ais/types';

const DEFAULT_HOOK_TIMEOUT_MS = 5000;
const MAX_HOOK_STDOUT_BYTES = 64 * 1024;

let _logger: AgwLogger = noopLogger;

export function setHooksLogger(logger: AgwLogger): void {
  _logger = logger;
}

async function runHookCommand(
  command: string,
  payload: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error(`hook timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_HOOK_STDOUT_BYTES) {
        if (!killed) {
          killed = true;
          child.kill('SIGKILL');
          clearTimeout(timer);
          reject(new Error(`hook stdout exceeded ${MAX_HOOK_STDOUT_BYTES} bytes`));
        }
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 4096) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!killed) reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) {
        const detail = stderr.trim() ? ` — ${stderr.trim().slice(0, 500)}` : '';
        reject(new Error(`hook exited with code ${code}${detail}`));
      } else {
        resolve(stdout);
      }
    });

    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        clearTimeout(timer);
        reject(err);
      }
    });
    try {
      child.stdin.write(payload);
      child.stdin.end();
    } catch (err) {
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno !== 'EPIPE') {
        clearTimeout(timer);
        reject(err as Error);
      }
    }
  });
}

export interface HookConfig {
  matcher: string;
  command: string;
  timeoutMs?: number;
}

export interface SessionLifecycleHook {
  command: string;
  timeoutMs?: number;
}

export interface HooksConfig {
  PreToolUse?: HookConfig[];
  PostToolUse?: HookConfig[];
  SessionStart?: SessionLifecycleHook[];
  PostCompact?: SessionLifecycleHook[];
}

export function matchesHookPattern(toolName: string, matcher: string): boolean {
  if (matcher === '*') return true;
  if (matcher === toolName) return true;
  if (matcher.endsWith('*') && !matcher.startsWith('*')) {
    return toolName.startsWith(matcher.slice(0, -1));
  }
  if (matcher.startsWith('*') && !matcher.endsWith('*')) {
    return toolName.endsWith(matcher.slice(1));
  }
  if (matcher.startsWith('*') && matcher.endsWith('*')) {
    return toolName.includes(matcher.slice(1, -1));
  }
  return false;
}

export interface PreToolHookResult {
  mutatedInput?: Record<string, unknown>;
  abort?: { error: string };
}

export async function runPreToolUseHooks(
  hooks: HookConfig[] | undefined,
  toolName: string,
  input: Record<string, unknown>,
  sessionId: string,
  scopeKey: string | null,
): Promise<PreToolHookResult> {
  if (!hooks || hooks.length === 0) return {};

  let currentInput = input;
  let mutated = false;

  for (const hook of hooks) {
    if (!matchesHookPattern(toolName, hook.matcher)) continue;

    const payload = JSON.stringify({
      tool: toolName,
      input: currentInput,
      sessionId,
      scopeKey,
    });

    try {
      const stdout = await runHookCommand(
        hook.command,
        payload,
        hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      );

      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            currentInput = parsed as Record<string, unknown>;
            mutated = true;
            _logger.info({ tool: toolName, matcher: hook.matcher }, 'PreToolUse hook mutated input');
          }
        } catch {
          // Non-JSON stdout is informational
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      _logger.warn({ tool: toolName, matcher: hook.matcher, err: msg }, 'PreToolUse hook aborted tool call');
      return {
        abort: {
          error: `PreToolUse hook "${hook.matcher}" aborted "${toolName}": ${msg}`,
        },
      };
    }
  }

  return mutated ? { mutatedInput: currentInput } : {};
}

export async function runSessionStartHooks(
  hooks: SessionLifecycleHook[] | undefined,
  sessionId: string,
  scopeKey: string | null,
): Promise<string[]> {
  if (!hooks || hooks.length === 0) return [];
  const outputs: string[] = [];

  const payload = JSON.stringify({
    event: 'SessionStart',
    sessionId,
    scopeKey,
  });

  for (const hook of hooks) {
    try {
      const stdout = await runHookCommand(
        hook.command,
        payload,
        hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      );
      const trimmed = stdout.trim();
      if (trimmed) {
        outputs.push(trimmed);
        _logger.info({ sessionId, bytes: trimmed.length }, 'SessionStart hook produced output');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      _logger.warn({ sessionId, err: msg }, 'SessionStart hook failed (non-fatal)');
    }
  }

  return outputs;
}

export async function runPostCompactHooks(
  hooks: SessionLifecycleHook[] | undefined,
  sessionId: string,
  scopeKey: string | null,
): Promise<string[]> {
  if (!hooks || hooks.length === 0) return [];
  const outputs: string[] = [];

  const payload = JSON.stringify({
    event: 'PostCompact',
    sessionId,
    scopeKey,
  });

  for (const hook of hooks) {
    try {
      const stdout = await runHookCommand(
        hook.command,
        payload,
        hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      );
      const trimmed = stdout.trim();
      if (trimmed) {
        outputs.push(trimmed);
        _logger.info({ sessionId, bytes: trimmed.length }, 'PostCompact hook produced output');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      _logger.warn({ sessionId, err: msg }, 'PostCompact hook failed (non-fatal)');
    }
  }

  return outputs;
}

export async function runPostToolUseHooks(
  hooks: HookConfig[] | undefined,
  toolName: string,
  input: unknown,
  output: unknown,
  sessionId: string,
  scopeKey: string | null,
): Promise<void> {
  if (!hooks || hooks.length === 0) return;

  for (const hook of hooks) {
    if (!matchesHookPattern(toolName, hook.matcher)) continue;

    const payload = JSON.stringify({
      tool: toolName,
      input,
      output,
      sessionId,
      scopeKey,
    });

    try {
      await runHookCommand(
        hook.command,
        payload,
        hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      _logger.warn({ tool: toolName, matcher: hook.matcher, err: msg }, 'PostToolUse hook failed (non-fatal)');
    }
  }
}
