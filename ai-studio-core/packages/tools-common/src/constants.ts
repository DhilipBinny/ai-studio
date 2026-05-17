// Fallback defaults — used only when RuntimeLimits not passed via context
// Single source of truth is agent-runtime/src/config.ts (DEFAULTS object)
// These are the same values, kept as fallback for edge cases
export const FILE_MAX_WRITE_SIZE = 10 * 1024 * 1024;
export const EXEC_MAX_STDOUT = 50 * 1024;
export const EXEC_MAX_STDERR = 10 * 1024;
export const EXEC_MAX_TIMEOUT_SECONDS = 300;
export const EXEC_DEFAULT_TIMEOUT_SECONDS = 30;
export const PDF_MAX_PAGES = 50;
export const PDF_TIMEOUT_MS = 60_000;
