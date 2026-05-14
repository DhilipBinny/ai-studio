import type { ToolExecutorFn } from "./types";

export const BUILTIN_EXECUTORS: Record<string, ToolExecutorFn> = {
  get_current_time: async (args) => {
    const tz = (args.timezone as string) || "UTC";
    return new Date().toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" });
  },

  calculate: async (args) => {
    const expr = args.expression as string;
    if (!expr) return "Error: expression is required";
    if (!/^[\d\s+\-*/().%]+$/.test(expr)) return "Error: invalid expression (only numbers and +,-,*,/,(),% allowed)";
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return String(result);
    } catch {
      return "Error: failed to evaluate expression";
    }
  },

  echo: async (args) => {
    return args.message as string || "No message provided";
  },
};
