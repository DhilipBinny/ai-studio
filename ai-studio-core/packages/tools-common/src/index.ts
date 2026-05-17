export { fileTools } from "./files";
export { execTools } from "./exec";
export { webTools } from "./web";
export { grepTools } from "./grep";
export { globTools } from "./glob";
export { patchTools } from "./patch";
export { pdfTools } from "./pdf";
export { batchReplaceTools } from "./batch-replace";
export { multiEditTools } from "./multi-edit";

export {
  resolveTenantPath,
  getAgentWorkspacePath,
  getProjectWorkspacePath,
  getSharedWorkspacePath,
  getTempPath,
  ensureWorkspace,
} from "./workspace";

export type { WorkspaceConfig, BuiltinToolContext } from "./types";
export { FILE_MAX_WRITE_SIZE, EXEC_MAX_STDOUT, EXEC_MAX_STDERR, EXEC_MAX_TIMEOUT_SECONDS, EXEC_DEFAULT_TIMEOUT_SECONDS } from "./constants";
export { validateFetchUrl, formatSearchResults } from "./web";
export { formatExecResult } from "./exec";
export { extractPatchPaths } from "./patch";

import type { ToolRegistration } from "@ais/tool-platform";
import { fileTools } from "./files";
import { execTools } from "./exec";
import { webTools } from "./web";
import { grepTools } from "./grep";
import { globTools } from "./glob";
import { patchTools } from "./patch";
import { pdfTools } from "./pdf";
import { batchReplaceTools } from "./batch-replace";
import { multiEditTools } from "./multi-edit";

export const allBuiltinTools: ToolRegistration[] = [
  ...fileTools,
  ...execTools,
  ...webTools,
  ...grepTools,
  ...globTools,
  ...patchTools,
  ...pdfTools,
  ...batchReplaceTools,
  ...multiEditTools,
];
