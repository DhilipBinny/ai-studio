export const BUILTIN_TOOL_RISK: Record<string, string> = {
  read_file: "safe", list_directory: "safe", glob: "safe", grep: "safe",
  web_fetch: "safe", web_search: "safe", read_pdf: "safe",
  get_current_time: "safe", calculate: "safe", echo: "safe",
  write_file: "moderate", edit_file: "moderate", apply_patch: "moderate",
  exec_command: "dangerous", batch_exec: "dangerous",
};

export const BUILTIN_TOOL_CATEGORY: Record<string, string> = {
  read_file: "file_operations", write_file: "file_operations", edit_file: "file_operations",
  list_directory: "file_operations", glob: "file_operations", read_pdf: "file_operations",
  apply_patch: "file_operations", grep: "search", web_fetch: "web", web_search: "web",
  exec_command: "execution", batch_exec: "execution",
  get_current_time: "utility", calculate: "utility", echo: "utility",
};
