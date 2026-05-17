import crypto from 'node:crypto';
import type { ToolDefinition, ToolResult, ToolExecutionContext, ToolPermissionLevel, JSONSchemaObject, JSONSchemaProperty, ToolProgress, DatabaseAdapter } from '@ais/types';
import { isToolResultEnvelope } from '@ais/types';
import type { ToolRegistration } from './types';
import type { AuditLogger, ToolCallRecorder } from './interfaces';
import type { PermissionChecker } from './permissions';
import { checkToolPermission } from './permissions';
import type { LoopDetector } from './loop-detector';
import type { ResultStorage } from './result-storage';
import type { ProgressBus } from './progress-bus';
import type { HooksConfig } from './hooks-runner';
import { runPreToolUseHooks, runPostToolUseHooks } from './hooks-runner';

interface Phase6ContextExtensions {
  loopDetector?: LoopDetector;
  resultStorage?: ResultStorage;
  progressBus?: ProgressBus;
}

const PREVIEW_MAX_CHARS = 500;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserialisable]';
    }
  }
}

function truncatePreview(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function renderPreview(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return safeStringify(result);
  if (isToolResultEnvelope(result)) {
    const parts: string[] = [];
    for (const block of result.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      } else if (block.type === 'image') {
        parts.push(`[${block.source.media_type || 'image'}]`);
      } else if (block.type === 'resource_link') {
        parts.push(`[link: ${block.title || block.uri}]`);
      } else if (block.type === 'persisted_reference') {
        parts.push(
          `[persisted ${block.sizeBytes}B at ${block.path}]\n${block.preview}`,
        );
      }
    }
    return parts.join('\n');
  }
  return safeStringify(result);
}

function validateArgs(
  args: Record<string, unknown>,
  schema: JSONSchemaObject,
): string[] {
  const errors: string[] = [];

  if (schema.required) {
    for (const field of schema.required) {
      if (args[field] === undefined || args[field] === null) {
        const prop = schema.properties[field];
        const expected = prop?.type || 'value';
        errors.push(`Missing required argument '${field}' (expected ${expected})`);
      }
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key] as JSONSchemaProperty | undefined;
    if (!prop) continue;

    if (value === undefined || value === null) continue;

    const expectedType = prop.type;
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (expectedType === 'string' && actualType !== 'string') {
      errors.push(`Argument '${key}': expected string, got ${actualType}`);
    } else if (expectedType === 'number' && actualType !== 'number') {
      errors.push(`Argument '${key}': expected number, got ${actualType}`);
    } else if (expectedType === 'boolean' && actualType !== 'boolean') {
      errors.push(`Argument '${key}': expected boolean, got ${actualType}`);
    } else if (expectedType === 'array' && actualType !== 'array') {
      errors.push(`Argument '${key}': expected array, got ${actualType}`);
    } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value))) {
      errors.push(`Argument '${key}': expected object, got ${actualType}`);
    }

    if (prop.enum && !prop.enum.includes(value as string)) {
      errors.push(`Argument '${key}': must be one of [${prop.enum.join(', ')}], got '${value}'`);
    }
  }

  return errors;
}

export interface ToolRegistryDeps {
  auditLogger?: AuditLogger;
  toolCallRecorder?: ToolCallRecorder;
  permissionChecker?: PermissionChecker;
}

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  private auditLogger?: AuditLogger;
  private toolCallRecorder?: ToolCallRecorder;
  private permissionChecker?: PermissionChecker;
  private hooks: HooksConfig = {};

  constructor(deps?: ToolRegistryDeps) {
    this.auditLogger = deps?.auditLogger;
    this.toolCallRecorder = deps?.toolCallRecorder;
    this.permissionChecker = deps?.permissionChecker;
  }

  setAuditLogger(audit: AuditLogger): void {
    this.auditLogger = audit;
  }

  setToolCallRecorder(recorder: ToolCallRecorder): void {
    this.toolCallRecorder = recorder;
  }

  setPermissionChecker(checker: PermissionChecker): void {
    this.permissionChecker = checker;
  }

  setHooks(hooks: HooksConfig | undefined): void {
    this.hooks = hooks ?? {};
  }

  register(tool: ToolRegistration): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  async getDefinitions(opts?: {
    userRole?: string;
    db?: DatabaseAdapter;
    tenantId?: string;
    elevated?: boolean;
  }): Promise<ToolDefinition[]> {
    const definitions: ToolDefinition[] = [];

    for (const reg of this.tools.values()) {
      if (opts?.userRole && opts.tenantId && this.permissionChecker) {
        const perm = await checkToolPermission(
          reg.definition.name,
          opts.userRole,
          opts.tenantId,
          opts.elevated ?? false,
          this.permissionChecker,
        );
        if (perm === 'deny') continue;
      }
      definitions.push(reg.definition);
    }

    return definitions;
  }

  async getAlwaysLoadDefinitions(opts?: {
    userRole?: string;
    db?: DatabaseAdapter;
    tenantId?: string;
    elevated?: boolean;
  }): Promise<ToolDefinition[]> {
    const all = await this.getDefinitions(opts);
    return all.filter((d) => d.alwaysLoad === true);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const registration = this.tools.get(name);
    if (!registration) {
      return { error: `Unknown tool: ${name}` };
    }

    let permission: ToolPermissionLevel = 'allow';
    const tenantId = context.tenant || (context as Record<string, unknown>).tenantId as string || 'default';
    const userRole = context.user?.role || 'user';
    const userElevated = !!context.user?.elevated;

    if (this.permissionChecker) {
      permission = await checkToolPermission(name, userRole, tenantId, userElevated, this.permissionChecker);
      if (permission === 'deny') {
        try {
          await this.auditLogger?.log({
            tenantId,
            userId: context.user?.id,
            action: 'tool.denied',
            resource: name,
            details: { role: userRole, args: Object.keys(args) },
          });
        } catch { /* audit should not break execution */ }
        return { error: `Permission denied: tool "${name}" is not allowed for role "${userRole}"` };
      }
    }

    const validationErrors = validateArgs(args, registration.definition.parameters);
    if (validationErrors.length > 0) {
      return { error: `Invalid arguments for tool "${name}": ${validationErrors.join('; ')}` };
    }

    if (registration.validateInput) {
      const check = registration.validateInput(args);
      if (!check.ok) {
        return { error: `Invalid input for tool "${name}": ${check.error}` };
      }
    }

    const callId = crypto.randomUUID();
    if (permission === 'confirm') {
      try {
        await this.auditLogger?.log({
          tenantId,
          userId: context.user?.id,
          action: 'tool.confirm_required',
          resource: name,
          details: { role: userRole, args: Object.keys(args), callId },
        });
      } catch { /* audit should not break execution */ }
      return { _requiresConfirmation: true, _callId: callId, tool: name, args } as unknown as ToolResult;
    }

    const ctxExt = context as Phase6ContextExtensions & ToolExecutionContext;
    const loopDetector = ctxExt.loopDetector;
    if (loopDetector) {
      const loopError = loopDetector.record(name, args);
      if (loopError) {
        try {
          await this.auditLogger?.log({
            tenantId,
            userId: context.user?.id,
            action: 'tool.loop_detected',
            resource: name,
            details: { tool: name, callId },
          });
        } catch { /* non-critical */ }
        return { error: loopError };
      }
    }

    const progressBus = ctxExt.progressBus;
    const progressSessionId =
      (context.session as unknown as { id?: string })?.id
      ?? context.session?.sessionId;
    if (progressBus && progressSessionId) {
      const argsJson = safeStringify(args);
      progressBus.emit({
        sessionId: progressSessionId,
        timestamp: Date.now(),
        kind: 'tool.start',
        toolName: name,
        toolCallId: callId,
        message: registration.getActivityDescription
          ? registration.getActivityDescription(args)
          : `Running ${name}`,
        argsPreview: truncatePreview(argsJson, PREVIEW_MAX_CHARS),
        argsLen: argsJson.length,
      });
    }

    let effectiveArgs = args;
    if (this.hooks.PreToolUse && this.hooks.PreToolUse.length > 0) {
      const hookSessionId = progressSessionId ?? 'unknown';
      const hookScopeKey = (context.scopeKey ?? null) as string | null;
      const hookResult = await runPreToolUseHooks(
        this.hooks.PreToolUse,
        name,
        args,
        hookSessionId,
        hookScopeKey,
      );
      if (hookResult.abort) {
        try {
          await this.auditLogger?.log({
            tenantId,
            userId: context.user?.id,
            action: 'tool.hook_aborted',
            resource: name,
            details: { tool: name, callId, reason: hookResult.abort.error },
          });
        } catch { /* non-critical */ }
        return { error: hookResult.abort.error };
      }
      if (hookResult.mutatedInput) {
        effectiveArgs = hookResult.mutatedInput;
        const reValidationErrors = validateArgs(effectiveArgs, registration.definition.parameters);
        if (reValidationErrors.length > 0) {
          try {
            await this.auditLogger?.log({
              tenantId,
              userId: context.user?.id,
              action: 'tool.hook_mutation_invalid',
              resource: name,
              details: { tool: name, callId, errors: reValidationErrors },
            });
          } catch { /* non-critical */ }
          return { error: `PreToolUse hook produced invalid args for "${name}": ${reValidationErrors.join('; ')}` };
        }
        if (registration.validateInput) {
          const semanticCheck = registration.validateInput(effectiveArgs);
          if (!semanticCheck.ok) {
            try {
              await this.auditLogger?.log({
                tenantId,
                userId: context.user?.id,
                action: 'tool.hook_mutation_invalid',
                resource: name,
                details: { tool: name, callId, error: semanticCheck.error },
              });
            } catch { /* non-critical */ }
            return { error: `PreToolUse hook produced invalid args for "${name}": ${semanticCheck.error}` };
          }
        }
      }
    }

    let wrappedContext: ToolExecutionContext = context;
    if (progressBus && progressSessionId) {
      wrappedContext = {
        ...context,
        progress: (event: ToolProgress) => {
          progressBus.emit({
            sessionId: progressSessionId,
            timestamp: Date.now(),
            kind: 'tool.progress',
            toolName: name,
            toolCallId: callId,
            message: event.message,
            fraction: event.fraction,
            data: event.data,
          });
        },
      };
    }

    const start = performance.now();
    let result: ToolResult;
    let status = 'success';

    try {
      result = await registration.executor(effectiveArgs, wrappedContext);

      if (typeof result === 'object' && result !== null && 'error' in result) {
        status = 'error';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result = { error: message };
      status = 'error';
    }

    if (this.hooks.PostToolUse && this.hooks.PostToolUse.length > 0) {
      const hookSessionId = progressSessionId ?? 'unknown';
      const hookScopeKey = (context.scopeKey ?? null) as string | null;
      void runPostToolUseHooks(
        this.hooks.PostToolUse,
        name,
        effectiveArgs,
        result,
        hookSessionId,
        hookScopeKey,
      );
    }

    const durationMs = Math.round(performance.now() - start);

    if (progressBus && progressSessionId) {
      const rendered = renderPreview(result);
      const isEnvelope = isToolResultEnvelope(result);
      progressBus.emit({
        sessionId: progressSessionId,
        timestamp: Date.now(),
        kind: status === 'error' ? 'tool.error' : 'tool.complete',
        toolName: name,
        toolCallId: callId,
        durationMs,
        resultPreview: truncatePreview(rendered, PREVIEW_MAX_CHARS),
        resultLen: rendered.length,
        resultPersisted: isEnvelope ? !!(result as { persisted?: boolean }).persisted : false,
      });
    }

    const storage = ctxExt.resultStorage;
    if (storage && isToolResultEnvelope(result)) {
      const threshold = registration.maxResultSizeChars;
      const persisted = storage.maybePersist(result.content, callId, threshold);
      if (persisted) {
        result = { ...result, content: persisted, persisted: true };
      }
    }

    const budget = context.resultBudget;
    if (budget) {
      let bytes = 0;
      const resultStr = typeof result === 'string' ? result : (result && typeof result === 'object' ? JSON.stringify(result) : '');
      try { bytes = Buffer.byteLength(resultStr, 'utf8'); } catch { /* ignore */ }
      const underBudget = budget.add(bytes);

      if (!underBudget && bytes > 10_000) {
        const maxChars = 10_000;
        const truncated = resultStr.slice(0, maxChars) + `\n... (truncated — ${bytes} bytes exceeded turn budget)`;
        result = typeof result === 'string' ? truncated : { _budgetTruncated: true, preview: truncated };
      }
    }

    if (this.toolCallRecorder) {
      try {
        await this.toolCallRecorder.record({
          id: callId,
          sessionId: context.session?.sessionId || 'unknown',
          tenantId,
          userId: context.user?.id,
          toolName: name,
          arguments: args,
          result,
          status,
          durationMs,
        });
      } catch {
        // Audit logging should not break tool execution
      }
    }

    try {
      await this.auditLogger?.log({
        tenantId,
        userId: context.user?.id,
        action: 'tool.execute',
        resource: name,
        details: { status, durationMs, callId },
      });
    } catch { /* audit should not break execution */ }

    return result;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get size(): number {
    return this.tools.size;
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  isConcurrencySafe(name: string): boolean {
    return this.tools.get(name)?.concurrencySafe ?? false;
  }
}
