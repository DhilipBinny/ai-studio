# 13. Security — Consolidated Security Measures

Complete inventory of all security mechanisms implemented across the platform.

---

## 13.1 Authentication

### Password Hashing — Argon2id

**File:** `packages/auth/src/password.ts`

| Parameter      | Value  |
|----------------|--------|
| Algorithm      | Argon2id (via @node-rs/argon2) |
| Memory cost    | 19456 KB (~19 MB) |
| Time cost      | 2 iterations |
| Parallelism    | 1 |
| Output length  | 32 bytes |

### JWT Tokens

**File:** `packages/auth/src/jwt.ts`

| Property        | Value                              |
|-----------------|------------------------------------|
| Algorithm       | HS256                              |
| Library         | jose                               |
| Issuer          | `ais`                              |
| Audience        | `ais-app`                          |
| Access token    | 15 minute expiry                   |
| Refresh token   | 7 day expiry                       |
| JTI             | Random 16 bytes hex (per-token)    |
| Secret          | `JWT_SECRET` env (min 32 chars)    |

**JWT Payload Claims:**

| Claim | Content                          |
|-------|----------------------------------|
| `sub` | User ID (UUID)                   |
| `tid` | Tenant ID (UUID)                 |
| `pid` | Profile ID                       |
| `rol` | User role                        |
| `arh` | SHA-256 hash of access rights    |
| `jti` | Token ID (for revocation)        |

### Cookie Flags

**File:** `web/src/app/api/auth/login/route.ts`

| Cookie          | httpOnly | secure (prod) | sameSite | path               | maxAge    |
|-----------------|----------|---------------|----------|--------------------|-----------|
| `access_token`  | true     | true          | strict   | `/`                | 15 min    |
| `refresh_token` | true     | true          | strict   | `/api/auth/refresh`| 7 days    |

The refresh token cookie is path-scoped to `/api/auth/refresh` — it is never sent to any other endpoint.

### Token Revocation

**Files:** `packages/database/src/schema/revoked-tokens.ts`, `web/src/app/api/auth/logout/route.ts`

- On logout: access token's JTI is inserted into `revoked_tokens` table with the token's expiry.
- On every authenticated request: `getAuthContext()` checks `revoked_tokens` table for the JTI, verifies the user's `isActive` flag, and verifies the user's `isLocked` status. Deactivated or locked users are rejected even with a valid JWT.
- Expired revocation entries are cleaned up hourly by `instrumentation.ts`.

**Database Table: revoked_tokens**

| Column      | Type           | Notes                         |
|-------------|----------------|-------------------------------|
| `id`        | `bigserial` PK |                               |
| `jti`       | `varchar(64)`  | Unique, indexed               |
| `user_id`   | `uuid` FK      | Cascade delete                |
| `reason`    | `varchar(50)`  | "logout", etc.                |
| `revoked_at`| `timestamptz`  |                               |
| `expires_at`| `timestamptz`  | For cleanup (indexed)         |

### Refresh Token Rotation

**File:** `web/src/app/api/auth/refresh/route.ts`

- Old refresh token is revoked on every use (single-use tokens).
- New refresh token + new access token issued.
- User status re-checked (active, not locked).
- Access rights hash re-computed from current profile.

### OTP (Two-Factor Authentication)

**Files:** `packages/auth/src/otp.ts`, `web/src/app/api/auth/otp/verify/route.ts`

- 6-digit numeric OTP generated with `crypto.randomInt`.
- OTP stored as SHA-256 hash in `otp` table.
- Verification uses `timingSafeEqual` (timing-attack resistant).
- Per-user unique session token (`etus`) links OTP to login attempt.
- Configurable via system settings (`enable_2fa`, `otp_validity_seconds`, `otp_max_resend`, `otp_block_duration_minutes`).
- OTP delivery via email (SMTP).

---

## 13.2 Authorization — RBAC

### Role Hierarchy

| Role          | Rank | Description                       |
|---------------|------|-----------------------------------|
| `super_admin` | 40   | Full platform access              |
| `admin`       | 30   | Administrative access             |
| `member`      | 20   | Standard user                     |
| `viewer`      | 10   | Read-only access                  |

**Constraint:** Users cannot assign roles equal to or above their own rank.

### Permission Levels

**File:** `packages/auth/src/rbac.ts`

| Level | Constant | Meaning            |
|-------|----------|---------------------|
| 0     | None     | No access           |
| 10    | View     | Read-only           |
| 20    | Manage   | Read + write        |

**Functions:**
- `hasPermission(rights, module, level)` — checks `rights[module] >= level`.
- `canView(rights, module)` — shorthand for level 10.
- `canManage(rights, module)` — shorthand for level 20.

### Modules

14 modules defined in `packages/types/src/modules.ts`:

| Module      | Section  | Route         |
|-------------|----------|---------------|
| DASHBOARD   | main     | /dashboard    |
| AGENTS      | build    | /agents       |
| TOOLS       | build    | /tools        |
| KNOWLEDGE   | build    | /knowledge    |
| WORKFLOWS   | build    | /workflows    |
| RUNS        | operate  | /runs         |
| SCHEDULED   | operate  | /scheduled    |
| CONNECTORS  | operate  | /connectors   |
| PROVIDERS   | operate  | /providers    |
| WORKSPACE   | operate  | /workspace    |
| USERS       | admin    | /users        |
| AUDIT       | admin    | /audit-log    |
| SETTINGS    | admin    | /settings     |
| PROFILES    | hidden   | /settings     |

### API Route Guards

**File:** `web/src/lib/api-utils.ts`

- `withAuth(handler)` — JWT validation + token revocation check + user active/unlocked check.
- `withRBAC(module, level, handler)` — calls `withAuth` then checks `hasPermission`.

---

## 13.3 Row-Level Security (RLS)

**File:** `packages/database/src/migrations/019_row_level_security.sql`

### Implementation

- PostgreSQL RLS policies on **all 36 tenant-scoped tables** (33 original + 3 from migration 021: `rag_evaluations`, `graph_entities`, `graph_relationships`).
- Policy: `USING (tenant_id = current_tenant_id())`
- `current_tenant_id()` reads from `app.current_tenant_id` session variable.
- RLS is **FORCE**d (applies even to table owner).

### Application Integration

**File:** `packages/database/src/tenant-scope.ts`

```typescript
export async function withTenantScope<T>(tenantId: string, fn: (db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
    return fn(tx);
  });
}
```

All application queries also include `WHERE tenant_id = ?` as belt-and-suspenders defense.

### Tables with RLS

agents, agent_tools, agent_connectors, agent_knowledge_bases, agent_sessions, agent_session_messages, agent_session_tool_calls, api_keys, audit_log, background_tasks, connectors, cron_jobs, document_chunks, documents, graph_entities, graph_relationships, knowledge_bases, otp, password_history, password_reset_requests, profiles, progress_spans, provider_models, providers, rag_evaluations, sessions, system_config, tool_permissions, tools, usage_records, users, workflow_edges, workflow_nodes, workflow_run_steps, workflow_runs, workflows

---

## 13.4 Input Validation — Zod Schemas

Every API endpoint validates input with Zod schemas before processing. All schemas are centralized in `packages/validation/src/`.

| Schema                     | File          | Validates                                    |
|----------------------------|---------------|----------------------------------------------|
| `loginSchema`              | `auth.ts`     | email + password                             |
| `otpVerifySchema`          | `auth.ts`     | etus + 6-digit OTP                           |
| `changePasswordSchema`     | `auth.ts`     | currentPassword + newPassword (12-128)       |
| `passwordResetRequestSchema`| `auth.ts`    | email                                        |
| `passwordResetSchema`      | `auth.ts`     | token + newPassword                          |
| `createUserSchema`         | `users.ts`    | email, name, password, role, profileId       |
| `updateUserSchema`         | `users.ts`    | name, role, profileId, settings (all opt)    |
| `createProfileSchema`      | `profiles.ts` | name, description, accessRights              |
| `updateProfileSchema`      | `profiles.ts` | name, description, accessRights (all opt)    |
| `createCronJobSchema`      | `cron-jobs.ts`| name, triggerType, schedule, prompt           |
| `updateCronJobSchema`      | `cron-jobs.ts`| All fields optional                          |
| `createApiKeySchema`       | `api-keys.ts` | name, scopedAgentIds, rateLimitRpm           |
| `paginationSchema`         | `common.ts`   | page, pageSize, sortOrder                    |

### parseJsonBody Helper

**File:** `web/src/lib/api-utils.ts`

Safe JSON body parsing that returns `null` instead of throwing on invalid JSON, preventing crash from malformed request bodies.

---

## 13.5 Encryption at Rest — AES-256-GCM

**File:** `packages/auth/src/encryption.ts`

### Algorithm

| Parameter     | Value          |
|---------------|----------------|
| Algorithm     | AES-256-GCM    |
| IV length     | 12 bytes       |
| Key source    | `ENCRYPTION_KEY` env (64 hex chars = 256 bits) |

### Key Rotation

- Keys are versioned: `ENCRYPTION_KEY` (v1), `ENCRYPTION_KEY_V2`, `ENCRYPTION_KEY_V3`, etc.
- Active version set by `ENCRYPTION_KEY_VERSION` env (default: 1).
- Encrypted format: `v{version}:{iv_base64}:{ciphertext_base64}:{tag_base64}`
- Decryption reads version from prefix, looks up correct key.
- `isEncrypted(value)` regex check for the format.

### What is Encrypted

| Data                           | Table       | Column            |
|--------------------------------|-------------|-------------------|
| Provider API keys              | `providers` | `api_key_ref`     |
| MCP connector env vars         | `connectors`| `connection_config.env` |
| Connector credentials          | `connectors`| `credentials_ref` |

### Migration

**File:** `packages/database/src/migrations/011_encrypt_secrets.ts`

One-time script to encrypt existing plaintext secrets. Checks `isEncrypted()` before re-encrypting.

---

## 13.6 SSRF Protection

**File:** `web/src/lib/services/validate-provider-url.ts`

Applied to user-supplied provider base URLs before any outbound HTTP request.

### Blocked Addresses

| Category           | Blocked                                              |
|-------------------|------------------------------------------------------|
| Loopback          | `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`          |
| Private IPv4      | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`    |
| Link-local IPv4   | `169.254.0.0/16`                                     |
| CGNAT             | `100.64.0.0/10`                                      |
| Reserved          | `240.0.0.0+`, `0.0.0.0/8`                           |
| IPv6 loopback     | `::1`, `::`                                           |
| IPv6 link-local   | `fe80::/10`                                           |
| IPv6 ULA          | `fc00::/7`, `fd00::/8`                               |
| IPv4-mapped IPv6  | `::ffff:x.x.x.x` (checked recursively)              |
| Cloud metadata    | `metadata.google.internal`, `metadata.google.com`, `instance-data` |
| Non-HTTP schemes  | Anything other than `http:` or `https:`              |

---

## 13.7 Path Traversal Protection

Applied to all workspace endpoints (`/api/workspace/files`, `/api/workspace/file`, `/api/workspace/download`).

### Checks (in order)

1. Null byte (`\0`) in path: rejected.
2. Control characters (`\x00-\x1f`, `\x7f`): rejected.
3. Absolute path (`path.isAbsolute()`): rejected.
4. `path.resolve(basePath, userPath)` must start with `basePath + path.sep` or equal `basePath`.
5. Symbolic links resolved via `fs.realpathSync()` must stay within basePath.

---

## 13.8 Rate Limiting

**File:** `packages/auth/src/rate-limit.ts`

In-memory sliding window rate limiter with automatic eviction.

### Endpoints with Rate Limiting

| Endpoint             | Limit                | Window     | Key Pattern               |
|----------------------|----------------------|------------|---------------------------|
| `POST /api/auth/login` | 5 attempts         | 15 minutes | `login:{ip}:{email}`      |
| `POST /api/auth/otp/verify` | 5 attempts   | 15 minutes | `otp:{etus}`              |

### RateLimiter Class

- Fixed window: count resets when windowMs elapses.
- Max 10,000 tracked keys (eviction at threshold).
- Returns `{ allowed, remaining, resetAt }`.
- Periodic full eviction every 1000 checks.

---

## 13.9 Account Lockout

**File:** `web/src/app/api/auth/login/route.ts`

| Parameter            | Value          |
|----------------------|----------------|
| Max failed attempts  | 10 (configurable via system settings) |
| Lockout behavior     | `is_locked=true`, `locked_at=now`     |

- Failed login increments `failedLoginAttempts`.
- At threshold: account locked permanently (requires admin unlock).
- Locked accounts return generic "Invalid email or password" (no oracle).
- Successful login resets `failedLoginAttempts` to 0.

### OTP Rate Limiting

OTP rate limiting uses **per-user database counters** on the `users` table, NOT the in-memory `RateLimiter` class:

- `otpRequestCount` (integer column on `users`) — incremented on each OTP request.
- `otpBlockedUntil` (timestamptz column on `users`) — set when count exceeds threshold.
- When `otpRequestCount >= otp_max_resend` (system setting): user is blocked for `otp_block_duration_minutes`.
- Block is enforced by checking `otpBlockedUntil > now()` before issuing new OTPs.
- This is persistent across server restarts (unlike the in-memory `RateLimiter` used for login).

---

## 13.10 Password Security

### Password Policy

**File:** `packages/auth/src/password-policy.ts`

| Rule               | Value                                    |
|--------------------|------------------------------------------|
| Min length         | 12 characters                            |
| Max length         | 128 characters                           |
| Min strength       | 3 (zxcvbn score, "strong")               |
| History count      | 5 (cannot reuse last 5 passwords)        |
| Reset token expiry | 30 minutes                               |

**Strength check:** Uses `zxcvbn-ts` with English + common dictionaries and keyboard adjacency graphs.

### Breach Check (HaveIBeenPwned)

**File:** `packages/auth/src/password-policy.ts`

- k-anonymity: only SHA-1 prefix (5 chars) sent to HIBP API.
- Padding headers enabled (`Add-Padding: true`).
- Non-blocking: network failure returns "not breached" (fail-open for availability).

### Password History

**File:** `packages/auth/src/password-history.ts`

- Last 5 hashes stored in `password_history` table.
- Each previous hash verified with Argon2id against new password.
- Prevents password reuse within history window.

---

## 13.11 Tenant Isolation

### Application Layer

- **Every query** includes `WHERE tenant_id = auth.tenantId`.
- `getAuthContext()` loads tenant ID from JWT claims.
- Workspace file paths scoped: `.data/tenants/{tenantId}/workspace/`.

### Database Layer (RLS)

- Row-Level Security on all 36 tenant-scoped tables (see 13.3).
- `SET LOCAL app.current_tenant_id` in transactions.
- Defense in depth: app-layer + RLS policies.

### Login Security

- Login query uses email only (not tenant-scoped) — user-to-tenant mapping is in the users table.
- This means users with the same email across tenants are impossible (email unique per tenant constraint).

---

## 13.12 CORS Policy

**File:** `web/src/middleware.ts`

- Origin allowlist from `CORS_ALLOWED_ORIGINS` env (comma-separated).
- Applied only to `/api/v1/` routes (external API).
- CORS preflight (OPTIONS) returns 204 with headers.
- Headers set: `Access-Control-Allow-Origin` (specific origin, not `*`), `Allow-Methods: GET, POST, OPTIONS`, `Allow-Headers: Content-Type, Authorization`, `Vary: Origin`.
- If no origins configured, no CORS headers set (deny by default).

---

## 13.13 Prompt Injection Detection

**File:** `ai-studio-core/packages/security/src/input.ts`

### Input Sanitization

`sanitizeInput(text, maxLength=50000)`:
1. Strip null bytes.
2. Strip zero-width characters (ZWC, ZWNJ, ZWSP, soft hyphen, word joiner, etc.).
3. Unicode NFC normalization.
4. Length truncation at 50,000 chars.

### Homoglyph Normalization

`normalizeForDetection(text)` — maps Cyrillic look-alikes to ASCII for pattern matching (not modifying user text).

### Prefix Injection Warning

`prefixInjectionWarning()` — generates a warning prefix injected into flagged messages (severity `warn`). The prefix wraps the original user input in `<flagged_input>` tags to alert the LLM that the content triggered a security pattern.

### Detection Patterns

| Pattern Name              | Severity | Regex Pattern                                      |
|---------------------------|----------|----------------------------------------------------|
| `instruction_override`    | block    | `ignore (all )?previous instructions`              |
| `prompt_format_injection` | block    | `[INST]`, `[/INST]`, `<\|system\|>`, `<\|user\|>` |
| `instruction_bypass`      | block    | `do not follow (your )?instructions`               |
| `instruction_disregard`   | block    | `disregard (all )?(your )?previous instructions`   |
| `override_safety`         | block    | `override (your )?safety rules`                    |
| `role_reassignment`       | warn     | `you are now a/an/my/the/in`                       |
| `system_prompt_injection` | warn     | `^system:` (line start)                            |
| `role_play_injection`     | warn     | `pretend you are`                                  |
| `prompt_extraction`       | warn     | `reveal (your )?(system )?prompt`                  |
| `mode_switch`             | warn     | `switch to unrestricted/developer/admin/debug mode`|
| `jailbreak`               | warn     | `jailbreak`                                        |

**Enforcement:** `block` severity = message rejected with "blocked by security policy". `warn` severity = message prefixed with `<flagged_input>` tag for the LLM.

### Output Filtering

**File:** `ai-studio-core/packages/security/src/output.ts`

`filterOutput(text)` — regex-based redaction of leaked secrets:

| Pattern                  | Replacement               |
|--------------------------|---------------------------|
| Internal API keys        | `ais_sk_***REDACTED***`   |
| OpenAI keys (`sk-`)      | `sk-***REDACTED***`       |
| Anthropic keys (`ant-`)  | `ant-***REDACTED***`      |
| Bearer tokens            | `Bearer ***REDACTED***`   |
| JWTs (eyJ...eyJ...)      | `***JWT_REDACTED***`      |
| Database URLs            | `***DB_URL_REDACTED***`   |
| OAuth tokens             | `***OAUTH_REDACTED***`    |
| AWS keys (AKIA...)       | `***AWS_KEY_REDACTED***`  |
| GCloud keys (AIza...)    | `***GCLOUD_KEY_REDACTED***` |
| GitHub tokens (`gho_`, `ghs_`, `github_pat_`) | `***GITHUB_TOKEN_REDACTED***` |
| Slack tokens (xox-)      | `***SLACK_TOKEN_REDACTED***` |
| Stripe keys (incl. `pk_live_`) | `***STRIPE_KEY_REDACTED***` |
| Private keys (PEM)       | `***PRIVATE_KEY_REDACTED***` |
| Generic secrets          | `key=***REDACTED***`      |

### Output Safety Check

`checkOutputSafety(text)` flags:
- `potential_data_exfiltration` — curl/wget/fetch with API key/token/secret.
- `destructive_command` — `rm -rf /`.
- `false_privilege_claim` — "I am now in admin mode".
- `system_file_modification` — attempts to write to IDENTITY/RULES/SOUL files.
- `credential_solicitation` — asking user for passwords/keys.
- `encoded_exfiltration` — large base64 blobs near send/post/fetch commands.

---

## 13.14 Audit Logging

See [12_admin.md, Section 12.4](./12_admin.md#124-audit-log) for full details.

- **Tamper-evident:** SHA-256 hash chain linking each entry to its predecessor.
- **Comprehensive:** Every write operation, auth event, and admin action is logged.
- **Immutable:** No update/delete API for audit entries.
- **Queryable:** Indexed by tenant, action, resource type/id, user.

---

## 13.15 Middleware Security

**File:** `web/src/middleware.ts`

### Public Paths (no auth required)

| Path                             | Purpose                |
|----------------------------------|------------------------|
| `/login`                         | Login page             |
| `/forgot-password`              | Password reset request |
| `/reset-password`               | Password reset form    |
| `/api/auth/login`               | Login API              |
| `/api/auth/refresh`             | Token refresh          |
| `/api/auth/password/reset-request` | Request reset link  |
| `/api/auth/password/reset`      | Execute reset          |
| `/api/auth/otp/verify`          | OTP verification       |
| `/api/health`                    | Health check           |
| `/embed/`                        | Embedded widget        |

### Protection Flow

1. `/api/v1/` routes: skip JWT, use API key auth (CORS applied).
2. All other routes: require `access_token` cookie.
3. JWT verified with `jose.jwtVerify()` (issuer + audience checked).
4. On success: tenant_id, user_id, profile_id set as response headers.
5. On failure: API routes get 401 JSON; page routes redirect to `/login`.

### Static Asset Bypass

Matcher excludes: `_next/static`, `_next/image`, `favicon.ico`, and image files (svg, png, jpg, jpeg, gif, webp).

---

## 13.16 Generic Error Messages

Login endpoint always returns "Invalid email or password" for both invalid email and invalid password — prevents user enumeration.

---

## 13.17 Security Summary Matrix

| Threat                   | Countermeasure                                        | Layer         |
|--------------------------|-------------------------------------------------------|---------------|
| Credential theft         | Argon2id + breach check + password history            | Auth          |
| Session hijacking        | HttpOnly/Secure/SameSite cookies, token rotation      | Auth          |
| Token replay             | JTI revocation table, 15-min expiry                   | Auth          |
| Brute force              | Rate limiting (5/15min), account lockout (10 attempts)| Auth          |
| Privilege escalation     | Role hierarchy enforcement, RBAC per endpoint         | Authorization |
| Cross-tenant access      | App-layer tenant scoping + PostgreSQL RLS             | Data          |
| SQL injection            | Drizzle ORM parameterized queries                     | Data          |
| XSS                      | React auto-escaping, HttpOnly cookies                 | Frontend      |
| SSRF                     | Private IP/metadata blocking on provider URLs         | Network       |
| Path traversal           | resolve() + prefix check + symlink validation         | Filesystem    |
| Prompt injection         | Pattern detection (block/warn), input sanitization    | AI            |
| Secret leakage           | Output filtering, AES-256-GCM encryption at rest      | AI + Data     |
| CORS abuse               | Explicit origin allowlist                              | Network       |
| Audit tampering          | SHA-256 hash chain                                    | Compliance    |
| OTP abuse                | Rate limit + block duration + timing-safe compare     | Auth          |
| RAG data leakage         | RLS on rag_evaluations, graph_entities, graph_relationships; tenant_id scoping in graph store methods; Qdrant payload filter on tenant_id | Data |
| RAG evaluate abuse       | Zod validation on evaluate endpoint, audit logging, tenant-scoped agent-KB check and provider lookup | AI + Data |
