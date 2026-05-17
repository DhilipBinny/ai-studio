# 11. Workspace — File Browser & Management

File system browser for viewing files produced by agent sessions and workflow runs. Files are stored on the local filesystem under tenant-scoped directories.

---

## Architecture Overview

```
Filesystem (.data/tenants/{tenantId}/workspace/)
    ├── agents/{agentId}/       ← agent scope
    │   └── {agentId}/          ← legacy path (auto-detected)
    ├── runs/{runId}/           ← run scope
    └── shared/                 ← shared scope
```

---

## 11.1 File Storage Layout

Files are organized under a data root (configurable via `DATA_ROOT` env var, defaults to `.data`):

```
{DATA_ROOT}/tenants/{tenantId}/workspace/
    ├── agents/{agentId}/       # Files scoped to an agent
    │   └── *.ts, *.py, etc.
    ├── runs/{runId}/           # Files scoped to a workflow run
    │   └── solution.ts, etc.
    └── shared/                 # Shared across all agents/runs
```

**Legacy support:** If `agents/{agentId}/` does not exist but `{agentId}/` does at the workspace root, the legacy path is used instead.

---

## 11.2 API Endpoints

### 11.2.1 File Listing

| Method | Path                 | Auth          | Description               |
|--------|----------------------|---------------|---------------------------|
| GET    | `/api/workspace/files` | JWT + RBAC (WORKSPACE, 10) | List directory contents |

**Query Parameters:**

| Parameter | Required | Description                                  |
|-----------|----------|----------------------------------------------|
| `scope`   | Yes      | `agent`, `run`, or `shared`                  |
| `id`      | Yes*     | Agent UUID or run UUID (* not needed for shared) |
| `path`    | No       | Subdirectory path relative to scope root     |

**Response:**
```json
{
  "path": "subfolder",
  "files": [
    { "name": "solution.ts", "type": "file", "size": 1234, "modifiedAt": "2026-05-15T10:30:00.000Z" },
    { "name": "lib", "type": "directory", "size": 0, "modifiedAt": "2026-05-15T09:00:00.000Z" }
  ]
}
```

**Behavior:**
- Directories sorted first, then files, alphabetically.
- Hidden files (dot-prefixed) are excluded.
- Symlinks are resolved and validated — must point within the base path (symlink jailbreak prevention).
- Returns empty `files` array if directory does not exist (not an error).

### 11.2.2 File Content Preview

| Method | Path                | Auth          | Description               |
|--------|---------------------|---------------|---------------------------|
| GET    | `/api/workspace/file` | JWT + RBAC (WORKSPACE, 10) | Read file content for preview |

**Query Parameters:**

| Parameter | Required | Description                                  |
|-----------|----------|----------------------------------------------|
| `scope`   | Yes      | `agent`, `run`, or `shared`                  |
| `id`      | Yes*     | Agent UUID or run UUID                       |
| `path`    | Yes      | File path relative to scope root             |

**Response:**
```json
{
  "name": "solution.ts",
  "path": "solution.ts",
  "size": 4567,
  "modifiedAt": "2026-05-15T10:30:00.000Z",
  "content": "// file contents here...",
  "truncated": false,
  "binary": false
}
```

**Behavior:**
- **Binary detection:** Scans first 8KB for null bytes. If found, `binary: true` and `content: null`.
- **Truncation:** Text files larger than 100KB (`MAX_PREVIEW_BYTES`) are truncated to 100KB; `truncated: true`.
- Returns 404 (`NOT_FOUND`) if file does not exist, 400 (`VALIDATION_ERROR`) if path is a directory or fails path validation.

### 11.2.3 File Download

| Method | Path                     | Auth          | Description          |
|--------|--------------------------|---------------|----------------------|
| GET    | `/api/workspace/download` | JWT + RBAC (WORKSPACE, 10) | Download raw file |

**Query Parameters:**

| Parameter | Required | Description                                  |
|-----------|----------|----------------------------------------------|
| `scope`   | Yes      | `agent`, `run`, or `shared`                  |
| `id`      | Yes*     | Agent UUID or run UUID                       |
| `path`    | Yes      | File path relative to scope root             |

**Response:**
- Raw file bytes with appropriate MIME type.
- `Content-Disposition: attachment; filename="{sanitized_name}"` header.
- Filename sanitized: non-word/dot/dash characters replaced with underscore.
- Maximum file size: 500MB (returns 413 if exceeded).

**MIME Type Map:**

| Extension              | MIME Type                |
|------------------------|--------------------------|
| `.json`                | `application/json`       |
| `.md`                  | `text/markdown`          |
| `.txt`                 | `text/plain`             |
| `.ts`, `.tsx`, `.js`, `.jsx` | `text/plain`       |
| `.py`, `.sh`, `.sql`   | `text/plain`             |
| `.css`                 | `text/css`               |
| `.html`                | `text/html`              |
| `.yaml`, `.yml`        | `text/yaml`              |
| `.xml`                 | `application/xml`        |
| `.csv`                 | `text/csv`               |
| `.pdf`                 | `application/pdf`        |
| `.png`                 | `image/png`              |
| `.jpg`, `.jpeg`        | `image/jpeg`             |
| `.gif`                 | `image/gif`              |
| `.svg`                 | `image/svg+xml`          |
| (other)                | `application/octet-stream` |

---

## 11.3 Path Traversal Protection

All three workspace endpoints implement identical path traversal guards:

1. **Null byte rejection:** `path.includes("\0")` returns 400.
2. **Control character rejection:** `/[\x00-\x1f\x7f]/` returns 400.
3. **Absolute path rejection:** `path.isAbsolute(subpath)` returns 400.
4. **Resolved path validation:** After `path.resolve(basePath, subpath)`, the result must start with `basePath + path.sep` (or equal basePath). Otherwise returns 403 "Path traversal denied".
5. **Symlink validation (files listing only):** Symbolic links are resolved via `fs.realpathSync()` and verified to stay within basePath.

---

## 11.4 UI Components

### FileBrowser

**File:** `web/src/components/workspace/file-browser.tsx`

**Props:**

| Prop       | Type                         | Description                     |
|------------|------------------------------|---------------------------------|
| `scope`    | `"agent" \| "run" \| "shared"` | File scope                   |
| `id`       | `string?`                    | Agent or run UUID               |
| `className`| `string?`                    | CSS class                       |

**Behavior:**
- Fetches `/api/workspace/files` with scope, id, and current path.
- Breadcrumb navigation with clickable path segments.
- Clicking a directory navigates into it; clicking a file opens FilePreview.
- Table with columns: Name (with file type icon), Size, Modified.
- Icons: Folder (amber), code files (blue), text files (green), generic (muted).
- Empty state with FolderOpen icon.
- Resets path and selection when scope or id changes.

### FilePreview

**File:** `web/src/components/workspace/file-preview.tsx`

**Behavior:**
- Fetches `/api/workspace/file` with scope, id, and path.
- Renders based on file type:
  - `.md` files: rendered as Markdown via `<Markdown>` component.
  - `.json` files: pretty-printed JSON in `<pre><code>`.
  - Code/text files: line-numbered table (monospace, hover highlight).
  - Binary files: "Binary file -- download to view" with download button.
- Truncation warning banner with download link when file is truncated.
- Download button always available in the header.
- Close button to dismiss preview.
- Loading spinner and error display.

---

## 11.5 Workspace Page

**File:** `web/src/app/(platform)/workspace/page.tsx`  
**Route:** `/(platform)/workspace`  
**Permission:** `RequirePermission module="WORKSPACE"`

Three tabs:

### Agent Workspaces Tab
- Left panel: list of agents (fetched from `/api/agents?pageSize=100`)
  - Shows agent name, slug, status badge
- Right panel: `<FileBrowser scope="agent" id={selectedAgentId} />`
- Grid layout: 280px sidebar + flexible content

### Workflow Runs Tab
- Left panel: two-level navigation
  - Level 1: list of workflows (from `/api/workflows?pageSize=50`)
  - Level 2: list of runs for selected workflow (from `/api/workflows/{id}/runs?pageSize=20`)
  - "Back to workflows" link to navigate up
  - Run entries show truncated ID, timestamp, status badge
- Right panel: `<FileBrowser scope="run" id={selectedRunId} />`

### Shared Files Tab
- Direct `<FileBrowser scope="shared" />` with no side panel

---

## 11.6 Integration in Other Pages

| Page                      | Usage                                    |
|---------------------------|------------------------------------------|
| Session Detail (`/runs`)  | EventFeed shows file operations as spans |
| Workflow Run Detail        | EventFeed shows file operations as spans |
| Workspace Page             | Dedicated browsing UI                    |

---

## 11.7 Security Summary

| Measure                   | Implementation                                           |
|---------------------------|----------------------------------------------------------|
| Authentication            | JWT cookie required (via `withRBAC`)                     |
| Authorization             | RBAC check: `WORKSPACE` module, level 10 (view)         |
| Tenant isolation          | Base path includes `tenantId` from JWT                   |
| Path traversal            | `path.resolve()` + prefix check on all three endpoints   |
| Symlink jailbreak         | `realpathSync()` validation in file listing              |
| Control characters        | Rejected in path parameter                               |
| File size limit           | 500MB max for download, 100KB for preview                |
| Filename sanitization     | Non-word characters replaced in download filename        |
