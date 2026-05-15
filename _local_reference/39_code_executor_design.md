# 39. Sandboxed Code Executor — System Design

**Date:** 2026-05-15
**Status:** Design (implement next session)
**Research:** 10 platforms analyzed (Dify, n8n, Retool, Pipedream, E2B, Modal, OpenAI, Cloudflare, Vercel, Langflow)
**Approach:** Docker sidecar service with Seccomp + per-language runtimes

---

## 1. Problem

The workflow engine's "code" node currently uses Node.js `vm.runInNewContext()` which is NOT a security sandbox (Node.js docs explicitly say so). Known escape vectors exist via prototype chains. Current mitigations (null prototypes) block known attacks but new ones get discovered regularly.

Langflow tried the same approach — got hit with 3 critical RCEs in 2025-2026.

---

## 2. Design Decision

**Docker sidecar code executor** — one container, one HTTP API, multiple language runtimes inside.

**Why this approach:**
- Dify and Retool both use this exact pattern in production
- We already run Docker (PostgreSQL is containerized)
- Process-level isolation (container) is stronger than V8 isolates
- Seccomp adds syscall filtering as defense-in-depth
- Multi-language support without separate infrastructure per language
- Near-zero cold start (persistent container, like Dify)

**Why not alternatives:**
- `isolated-vm`: JS only, maintenance mode, V8 memory OOM crashes host
- Firecracker: Requires KVM, operational complexity overkill for our scale
- E2B: External dependency, data leaves our infrastructure
- Cloudflare Workers: Vendor lock-in, JS only (Python experimental)

---

## 3. Architecture

```
ai-studio-app/web (Next.js)
    |
    | POST /execute
    | { language, code, state, timeout, memoryMB }
    v
--- code-executor (Docker container) ---
|                                       |
|  Express/Fastify HTTP API (port 8090) |
|                                       |
|  Request Handler:                     |
|  1. Validate input                    |
|  2. Dispatch to language runtime      |
|  3. Enforce timeout + memory limit    |
|  4. Return { output, error, duration }|
|                                       |
|  JavaScript Runtime:                  |
|    isolated-vm (V8 isolate)           |
|    128MB heap limit, 5s timeout       |
|                                       |
|  Python Runtime:                      |
|    subprocess with resource limits    |
|    256MB memory, 5s timeout           |
|                                       |
|  Security:                            |
|  - Seccomp profile (syscall filter)   |
|  - Read-only filesystem               |
|  - No network access                  |
|  - Non-root user                      |
|  - Memory + CPU + PID limits          |
-----------------------------------------
```

---

## 4. HTTP API Contract

### POST /execute

**Request:**
```json
{
  "language": "javascript",
  "code": "const items = state.input.data;\nreturn { count: items.length };",
  "state": { "input": { "data": [1, 2, 3] } },
  "timeout": 5000,
  "memoryMB": 128
}
```

**Response (success):**
```json
{
  "success": true,
  "output": { "count": 3 },
  "durationMs": 12,
  "memoryUsedMB": 4
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "ReferenceError: fetch is not defined",
  "durationMs": 2
}
```

### GET /health

```json
{
  "status": "healthy",
  "languages": ["javascript", "python"],
  "uptime": 3600,
  "executionsTotal": 142
}
```

---

## 5. Docker Setup

### Dockerfile
- Base: `node:22-slim`
- Install Python3 via apt
- Non-root user (`executor`)
- Read-only filesystem (tmpfs for /tmp only)
- Port 8090

### Docker Compose addition
```yaml
code-executor:
  build: ../packages/code-executor
  ports: ["8090:8090"]
  security_opt: [seccomp:seccomp-profile.json]
  read_only: true
  tmpfs: [/tmp:size=100M]
  mem_limit: 512m
  cpus: "1.0"
  pids_limit: 50
  networks: [internal]
```

---

## 6. JavaScript Runtime (inside container)

Uses `isolated-vm` for V8 isolate-level isolation:
- Creates a new V8 isolate per execution (memory-limited)
- Injects state via `ExternalCopy` (frozen, no shared references)
- Only exposes JSON.parse/stringify as safe globals
- Timeout enforced by isolated-vm
- Isolate disposed after execution (no state leak)
- Output serialized via structured clone (no prototype tricks)

**Why isolated-vm inside Docker:** Double isolation. Container prevents system access. V8 isolate prevents Node.js API access within the container.

---

## 7. Python Runtime (inside container)

Uses subprocess with resource limits:
- Spawns `python3 -c` with the user code
- State passed via stdin (JSON)
- Output read from stdout (JSON)
- `resource.setrlimit` for memory cap
- Restricted builtins: blocked `__import__`, `open`, `exec`, `compile`
- Sanitized env (PATH, HOME only)
- Killed after timeout

---

## 8. Security Layers (Defense in Depth)

| Layer | What it prevents |
|---|---|
| **Docker container** | No access to host filesystem, processes, network |
| **Seccomp profile** | Blocks dangerous syscalls (mount, ptrace, reboot) |
| **Read-only filesystem** | Can't write to disk (except /tmp, 100MB) |
| **No network** | Can't reach internal services or exfiltrate data |
| **Non-root user** | Can't escalate privileges |
| **Memory limit** | Can't exhaust host memory (512MB container cap) |
| **CPU limit** | Can't hog CPU (1 core) |
| **PID limit** | Can't fork-bomb (50 processes) |
| **Timeout** | Can't run indefinitely (5-10s) |
| **V8 isolate (JS)** | Can't access Node.js APIs inside container |
| **Python builtins restricted** | Can't import os, subprocess, socket |

---

## 9. Workflow Engine Integration

Replace `vm.runInNewContext` in `node-handlers.ts` with HTTP call:

```typescript
case "code": {
  const language = config.language || "javascript";
  const executorUrl = process.env.CODE_EXECUTOR_URL || "http://localhost:8090";

  const res = await fetch(`${executorUrl}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language,
      code: config.code,
      state: JSON.parse(JSON.stringify(state)),
      timeout: 5000,
      memoryMB: 128,
    }),
  });

  const result = await res.json();
  if (!result.success) throw new Error(`Code execution failed: ${result.error}`);
  return { output: result.output, paused: false };
}
```

---

## 10. Canvas UI Changes

Add language dropdown to code node config panel:
- Language: JavaScript | Python (dropdown)
- Code editor (existing textarea)
- Timeout: configurable (default 5000ms)
- Memory: configurable (default 128MB)

---

## 11. Files to Create

| File | Purpose |
|---|---|
| `packages/code-executor/Dockerfile` | Docker image |
| `packages/code-executor/src/server.ts` | HTTP API |
| `packages/code-executor/src/js-runtime.ts` | JS via isolated-vm |
| `packages/code-executor/src/python-runtime.ts` | Python via subprocess |
| `packages/code-executor/seccomp-profile.json` | Syscall filter |
| `packages/code-executor/package.json` | Dependencies |

## 12. Files to Modify

| File | Change |
|---|---|
| `infra/docker-compose.yml` | Add code-executor service |
| `workflow/node-handlers.ts` | Replace vm with HTTP call |
| `workflow/types.ts` | Add `language` to NodeConfig |
| `node-config-panel.tsx` | Add language dropdown |

---

## 13. Implementation Plan

1. Create `packages/code-executor/` package
2. Write Dockerfile + seccomp profile
3. Implement HTTP API server
4. Implement JS runtime (isolated-vm)
5. Implement Python runtime (subprocess + restrictions)
6. Add to docker-compose.yml
7. Update workflow node-handlers to call executor
8. Update canvas UI with language dropdown
9. Test: JS execution, Python execution, timeout, memory, security
10. Type check + browser test

**Estimated effort:** 3-5 days
**Infrastructure needed:** Docker (already have it)
