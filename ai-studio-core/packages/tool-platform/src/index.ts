export { ToolRegistry, type ToolRegistryDeps } from './registry';
export type { ToolRegistration, ToolExecutor } from './types';
export { textEnvelope, imageEnvelope, envelope } from './envelope';
export { LoopDetector, DEFAULT_WINDOW_SIZE, DEFAULT_TRIP_THRESHOLD } from './loop-detector';
export { ResultBudget, DEFAULT_RESULT_BUDGET_BYTES } from './result-budget';
export { ResultStorage, DEFAULT_PERSIST_THRESHOLD_BYTES, PREVIEW_CHARS, type ResultStorageOptions } from './result-storage';
export { ProgressBus, type ProgressEvent, type ProgressSubscriber } from './progress-bus';
export { checkToolPermission, type PermissionChecker } from './permissions';
export type { AuditLogger, ToolCallRecorder } from './interfaces';
export {
  matchesHookPattern,
  runPreToolUseHooks,
  runPostToolUseHooks,
  runSessionStartHooks,
  runPostCompactHooks,
  setHooksLogger,
  type HookConfig,
  type HooksConfig,
  type SessionLifecycleHook,
  type PreToolHookResult,
} from './hooks-runner';
