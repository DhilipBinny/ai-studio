export interface AgwLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  child(bindings: Record<string, unknown>): AgwLogger;
}

export const noopLogger: AgwLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() { return noopLogger; },
};
