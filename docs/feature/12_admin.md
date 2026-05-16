# 12. Administration — Users, Profiles, Settings, Audit, Cron, API Keys, Dashboard

Admin domain covering user/profile management, system configuration, audit logging, scheduled jobs, API key management, and the dashboard.

---

## 12.1 User Management

### API Endpoints

| Method | Path                              | Auth (Module, Level) | Description                    |
|--------|-----------------------------------|----------------------|--------------------------------|
| GET    | `/api/users`                      | USERS, 10            | List users (paginated)         |
| POST   | `/api/users`                      | USERS, 20            | Create user                    |
| GET    | `/api/users/[id]`                 | USERS, 10            | Get user detail                |
| PATCH  | `/api/users/[id]`                 | USERS, 20            | Update user                    |
| POST   | `/api/users/[id]/deactivate`      | USERS, 20            | Soft-delete (deactivate)       |
| POST   | `/api/users/[id]/reactivate`      | USERS, 20            | Reactivate deactivated user    |
| PATCH  | `/api/users/[id]/password`        | JWT (withAuth) | Change/reset password (authorization logic inside handler) |

### List Users (GET /api/users)

- Paginated with `paginationSchema` (page, pageSize, sortOrder).
- `search` parameter: ILIKE on email (with `escapeLike` for wildcard safety).
- `showAll=true` includes inactive users; default shows only active.
- Returns user data joined with profile name.

### Create User (POST /api/users)

**Validation:** `createUserSchema` (Zod)

| Field      | Validation                                    |
|------------|-----------------------------------------------|
| `email`    | Valid email                                   |
| `name`     | 1-255 chars                                   |
| `password` | 12-128 chars                                  |
| `role`     | `super_admin \| admin \| member \| viewer`    |
| `profileId`| UUID, optional                                |

**Business Rules:**
1. **Role hierarchy enforcement:** Cannot assign role >= caller's rank.
   - Ranks: super_admin=40, admin=30, member=20, viewer=10.
2. **Email uniqueness:** Per-tenant unique constraint.
3. **Profile validation:** If profileId provided, must exist in same tenant.
4. **Password strength:** `validatePassword()` with zxcvbn (minStrength=3).
5. **Breach check:** HaveIBeenPwned k-anonymity check.
6. **Password history:** Initial hash saved to `password_history`.
7. **Audit log:** `user.create` entry created.

### Update User (PATCH /api/users/[id])

**Validation:** `updateUserSchema` (Zod)

| Field      | Validation                    |
|------------|-------------------------------|
| `name`     | 1-255 chars, optional         |
| `role`     | Role enum, optional           |
| `profileId`| UUID or null, optional        |
| `settings` | Record, optional              |

**Business Rules:**
- Cannot change own role (`SELF_ROLE_CHANGE`).
- Cannot assign role >= own rank (`ROLE_ESCALATION`).
- Audit entry: `user.update`.

### Deactivate (POST /api/users/[id]/deactivate)

- Sets `isActive=false`, `deactivatedAt=now`.
- Cannot deactivate yourself.
- Audit entry: `user.deactivate`.

### Reactivate (POST /api/users/[id]/reactivate)

- Sets `isActive=true`, `deactivatedAt=null`.
- Returns error if already active.
- Audit entry: `user.reactivate`.

### Change Password (PATCH /api/users/[id]/password)

**Two modes:**

**Self-change (user changing own password):**
- Requires `currentPassword` verification.
- `changePasswordSchema`: currentPassword + newPassword (12-128 chars).
- Checks: password strength, breach check, password history (last 5).
- Sets `requirePasswordChange=false`.

**Admin reset (admin changing another user's password):**
- Requires `canManage(auth.accessRights, "USERS")`.
- Only `newPassword` required.
- Sets `requirePasswordChange=true`.

**Common behavior:**
- Revokes all active sessions for the user.
- Saves new hash to `password_history`.
- Audit entry: `user.password_change` with `{ changedBy: "self"|"admin" }`.

### Database Table: users

| Column                    | Type           | Notes                                |
|---------------------------|----------------|--------------------------------------|
| `id`                      | `uuid` PK      |                                      |
| `tenant_id`               | `uuid` FK       | Cascade delete                       |
| `profile_id`              | `uuid` FK       | Set null on delete                   |
| `email`                   | `text`          | Unique per tenant                    |
| `name`                    | `text`          |                                      |
| `password_hash`           | `text`          | Argon2id hash                        |
| `role`                    | `user_role` enum| super_admin/admin/member/viewer      |
| `avatar_url`              | `text`          |                                      |
| `settings`                | `jsonb`         | User preferences                     |
| `is_locked`               | `boolean`       | Account lockout                      |
| `failed_login_attempts`   | `integer`       | Counter for lockout                  |
| `locked_at`               | `timestamptz`   |                                      |
| `last_login_at`           | `timestamptz`   |                                      |
| `password_changed_at`     | `timestamptz`   |                                      |
| `require_password_change` | `boolean`       | Set by admin password reset          |
| `otp_request_count`       | `integer`       | OTP rate limiting                    |
| `otp_blocked_until`       | `timestamptz`   | OTP block expiry                     |
| `is_active`               | `boolean`       | Soft delete flag                     |
| `deactivated_at`          | `timestamptz`   |                                      |
| `created_at`              | `timestamptz`   |                                      |
| `updated_at`              | `timestamptz`   |                                      |

**Indexes:** `(tenant_id, email)` UNIQUE, `(tenant_id)`, `(email)`, `(profile_id)`

---

## 12.2 Profile Management

Profiles define access rights (permission levels per module) assigned to users.

### API Endpoints

| Method | Path                  | Auth (Module, Level) | Description           |
|--------|-----------------------|----------------------|-----------------------|
| GET    | `/api/profiles`       | PROFILES, 10         | List active profiles  |
| POST   | `/api/profiles`       | PROFILES, 20         | Create profile        |
| PATCH  | `/api/profiles/[id]`  | PROFILES, 20         | Update profile        |
| DELETE | `/api/profiles/[id]`  | PROFILES, 20         | Soft-delete profile   |

### Access Rights Matrix

Each profile has an `accessRights` JSONB field mapping module IDs to permission levels:

| Module      | Level 0  | Level 10 | Level 20 |
|-------------|----------|----------|----------|
| DASHBOARD   | No access| View     | Manage   |
| AGENTS      | No access| View     | Manage   |
| TOOLS       | No access| View     | Manage   |
| KNOWLEDGE   | No access| View     | Manage   |
| WORKFLOWS   | No access| View     | Manage   |
| RUNS        | No access| View     | Manage   |
| SCHEDULED   | No access| View     | Manage   |
| CONNECTORS  | No access| View     | Manage   |
| PROVIDERS   | No access| View     | Manage   |
| WORKSPACE   | No access| View     | Manage   |
| USERS       | No access| View     | Manage   |
| PROFILES    | No access| View     | Manage   |
| AUDIT       | No access| View     | Manage   |
| SETTINGS    | No access| View     | Manage   |
| DOCS        | No access| View     | Manage   |

**Validation:** `createProfileSchema` / `updateProfileSchema` — each permission level is `z.union([z.literal(0), z.literal(10), z.literal(20)])`.

### Business Rules

- Profile name must be unique per tenant.
- System profiles (`isSystem=true`) cannot be renamed or deleted.
- Delete is soft: sets `isActive=false`.
- Audit entries: `profile.create`, `profile.update`, `profile.delete`.

### Database Table: profiles

| Column          | Type           | Notes                             |
|-----------------|----------------|-----------------------------------|
| `id`            | `uuid` PK      |                                   |
| `tenant_id`     | `uuid` FK       | Cascade delete                    |
| `name`          | `text`          | Unique per tenant                 |
| `description`   | `text`          |                                   |
| `access_rights` | `jsonb`         | Module -> permission level map    |
| `is_system`     | `boolean`       | Cannot rename/delete              |
| `is_active`     | `boolean`       | Soft delete                       |
| `created_at`    | `timestamptz`   |                                   |
| `updated_at`    | `timestamptz`   |                                   |

---

## 12.3 System Settings

Key-value configuration per tenant with Zod-based validation per section.

### API Endpoints

| Method | Path            | Auth (Module, Level) | Description            |
|--------|-----------------|----------------------|------------------------|
| GET    | `/api/settings` | SETTINGS, 10         | Get all config entries |
| PATCH  | `/api/settings` | SETTINGS, 20         | Update config entries  |

### Request Shape (PATCH)

```json
{
  "entries": [
    { "key": "general", "value": { "app_name": "My Studio", "timezone": "Asia/Singapore" } },
    { "key": "auth", "value": { "enable_2fa": true, "max_failed_attempts": 10 } }
  ]
}
```

### Configuration Sections

**General:**

| Key        | Type    | Default         | Options                                           |
|------------|---------|-----------------|---------------------------------------------------|
| `app_name` | text    | Brand name      | Required                                          |
| `timezone` | select  | Asia/Singapore  | 14 timezone options                               |

**Authentication:**

| Key                         | Type    | Default | Range    |
|-----------------------------|---------|---------|----------|
| `enable_2fa`                | boolean | false   | --       |
| `max_failed_attempts`       | number  | 10      | 3-50     |
| `otp_validity_seconds`      | number  | 300     | 60-900   |
| `otp_max_resend`            | number  | 5       | 1-20     |
| `otp_block_duration_minutes`| number  | 30      | 5-120    |

**Billing & Cost:**

| Key                  | Type    | Default | Range      |
|----------------------|---------|---------|------------|
| `cost_margin_factor` | number  | 1.0     | 1.0-10.0   |
| `cost_currency`      | select  | USD     | USD/EUR/GBP/SGD/INR/JPY/AUD |

### Validation

`validateConfigValue(sectionKey, value)` checks:
- Required fields not empty.
- Number fields within min/max.
- Select fields match allowed options.

Upsert semantics: uses `ON CONFLICT DO UPDATE` on `(tenant_id, key)`.

### Database Table: system_config

| Column       | Type           | Notes                               |
|--------------|----------------|-------------------------------------|
| `id`         | `uuid` PK      |                                     |
| `tenant_id`  | `uuid` FK       | Cascade delete                      |
| `key`        | `text`          | Section key (e.g. "general", "auth")|
| `value`      | `jsonb`         | Configuration values                |
| `updated_by` | `uuid` FK       | Last updater                        |
| `created_at` | `timestamptz`   |                                     |
| `updated_at` | `timestamptz`   |                                     |

**Constraints:** `UNIQUE(tenant_id, key)`

---

## 12.4 Audit Log

Tamper-evident audit trail with chained SHA-256 hashes.

### API Endpoints

| Method | Path             | Auth (Module, Level) | Description          |
|--------|------------------|----------------------|----------------------|
| GET    | `/api/audit-log` | AUDIT, 10            | List audit entries   |

### Query Parameters

| Parameter      | Description                              |
|----------------|------------------------------------------|
| `action`       | ILIKE filter on action name              |
| `resourceType` | Exact match on resource type             |
| `page`         | Page number                              |
| `pageSize`     | Items per page                           |

### Audit Entry Creation

**File:** `web/src/lib/services/audit.ts`

Every write operation calls `createAuditEntry()` which:

1. Fetches the previous entry's `entryHash` for the tenant.
2. Computes new `entryHash` via `computeAuditHash()` — SHA-256 over:
   - Previous hash (chain link)
   - Action, userId, resourceType, resourceId
   - Deterministically-sorted details JSON
   - Timestamp
3. Inserts with both `prevHash` and `entryHash`.

This creates a hash chain — tampering with any entry breaks the chain from that point forward.

### Tracked Actions

| Action                | Resource Type  | Context                          |
|-----------------------|----------------|----------------------------------|
| `auth.login`          | --             | Successful login                 |
| `auth.login_failed`   | --             | Failed login attempt             |
| `auth.logout`         | --             | User logout                      |
| `user.create`         | `user`         | New user created                 |
| `user.update`         | `user`         | User fields updated              |
| `user.deactivate`     | `user`         | User deactivated                 |
| `user.reactivate`     | `user`         | User reactivated                 |
| `user.password_change`| `user`         | Password changed                 |
| `profile.create`      | `profile`      | New profile created              |
| `profile.update`      | `profile`      | Profile updated                  |
| `profile.delete`      | `profile`      | Profile soft-deleted             |
| `settings.update`     | `system_config`| System settings changed          |
| `cron.create`         | `cron_job`     | Scheduled job created            |
| `cron.update`         | `cron_job`     | Scheduled job updated            |
| `cron.delete`         | `cron_job`     | Scheduled job deleted            |
| `cron.run_now`        | `cron_job`     | Manual job trigger               |
| `api_key.create`      | `api_key`      | API key generated                |
| `api_key.revoke`      | `api_key`      | API key revoked                  |
| `agent.create`        | `agent`        | Agent created                    |
| `agent.update`        | `agent`        | Agent updated                    |
| `provider.create`     | `provider`     | Provider created                 |
| `provider.update`     | `provider`     | Provider updated                 |
| (and more...)         |                |                                  |

### Database Table: audit_log

| Column         | Type           | Notes                              |
|----------------|----------------|------------------------------------|
| `id`           | `bigserial` PK | Auto-increment                     |
| `tenant_id`    | `uuid` FK       | Cascade delete                     |
| `user_id`      | `uuid` FK       | Set null on delete                 |
| `action`       | `text`          | Action identifier                  |
| `resource_type`| `text`          | Entity type                        |
| `resource_id`  | `text`          | Entity UUID                        |
| `details`      | `jsonb`         | Contextual data                    |
| `ip_address`   | `inet`          | Client IP                          |
| `user_agent`   | `text`          | Browser user-agent                 |
| `prev_hash`    | `text`          | Previous entry's hash (chain link) |
| `entry_hash`   | `text`          | SHA-256 of this entry              |
| `created_at`   | `timestamptz`   |                                    |

**Indexes:** `(tenant_id)`, `(tenant_id, created_at)`, `(action)`, `(resource_type, resource_id)`, `(user_id)`

---

## 12.5 Scheduled Jobs / Cron

CRUD for scheduled jobs that trigger agent sessions or workflow runs on cron, interval, or one-time schedules.

### API Endpoints

| Method | Path                        | Auth (Module, Level) | Description              |
|--------|-----------------------------|----------------------|--------------------------|
| GET    | `/api/cron-jobs`            | SETTINGS, 10         | List jobs (paginated)    |
| POST   | `/api/cron-jobs`            | SETTINGS, 20         | Create job               |
| PATCH  | `/api/cron-jobs/[id]`       | SETTINGS, 20         | Update job               |
| DELETE | `/api/cron-jobs/[id]`       | SETTINGS, 20         | Delete job               |
| POST   | `/api/cron-jobs/[id]`       | SETTINGS, 20         | Run job immediately      |
| GET    | `/api/cron-jobs/[id]/runs`  | SETTINGS, 10         | Paginated run history    |

### Create Job Validation

**Schema:** `createCronJobSchema`

| Field           | Validation                                |
|-----------------|-------------------------------------------|
| `name`          | 1-255 chars                               |
| `triggerType`   | `"agent"` or `"workflow"`                 |
| `agentId`       | UUID, required if triggerType=agent       |
| `workflowId`    | UUID, required if triggerType=workflow    |
| `scheduleType`  | `"cron"`, `"every"`, or `"at"`           |
| `scheduleValue` | 1-255 chars (cron expr / minutes / ISO datetime) |
| `timezone`      | Max 100 chars, optional                   |
| `prompt`        | 1-50000 chars                             |
| `workflowInput` | JSON object, optional (passed to workflow trigger) |

**Schedule type validation (Zod refinement):**
- `cron`: must have exactly 5 fields (minute hour day month weekday).
- `every`: must be a positive integer (interval in minutes).
- `at`: must be a valid ISO 8601 datetime string.

### Schedule Types

| Type | scheduleValue | Behavior |
|------|---------------|----------|
| `cron` | `"*/5 * * * *"` | Standard 5-field cron expression, evaluated every 60s tick |
| `every` | `"15"` | Run every N minutes (tracked via `lastRun` + interval comparison) |
| `at` | `"2026-05-20T14:00:00Z"` | Run once at specified time, then auto-disables (`enabled=false`) |

### Update Job (PATCH)

Supports updating: `name`, `triggerType`, `agentId`, `workflowId`, `scheduleType`, `scheduleValue`, `timezone`, `prompt`, `enabled`, `workflowInput`.

Switching `triggerType` (e.g. agent→workflow) nulls the previous reference field.

### Cron Scheduler

**File:** `packages/agent-runtime/src/cron-scheduler.ts`

- **Tick interval:** Every 60 seconds, evaluates all enabled jobs.
- **Cron matching:** Full 5-field cron expression parser supporting:
  - Wildcards (`*`)
  - Ranges (`1-5`)
  - Steps (`*/5`, `1-10/2`)
  - Lists (`1,3,5`)
- **Interval matching (`every`):** Checks if `now - lastRun >= intervalMinutes * 60_000`.
- **One-time matching (`at`):** Checks if `scheduledTime <= now` and hasn't run yet.
- **Timezone support:** Converts current time to job's timezone via `Intl.DateTimeFormat`.
- **Concurrency guard:** `runningJobs` Set prevents double-execution of same job.
- **Execution:** Calls `runSession()` for agent triggers, `triggerWorkflow()` for workflow triggers.
- **Workflow input:** If `workflowInput` is set, passed as the `input` parameter to `triggerWorkflow()`.
- **Run history:** Inserts a `cron_job_runs` record at start (status=running), updates on complete/fail with duration and result.
- **Result tracking:** Updates `lastRun`, `lastResult`, `lastError`, `runCount` on the job record.
- **Auto-disable:** "at" jobs are automatically disabled after execution (`enabled=false`).
- **Trigger field:** Each run records whether it was `"scheduled"` or `"manual"`.
- **Started by:** `instrumentation.ts` on server boot.
- **Stopped by:** `stopCronScheduler()` — clears the 60-second interval timer.
- **Manual trigger:** `runJobNow(jobId, tenantId)` executes immediately.

### Database Table: cron_jobs

| Column           | Type           | Notes                              |
|------------------|----------------|------------------------------------|
| `id`             | `uuid` PK      |                                    |
| `tenant_id`      | `uuid` FK       | Cascade delete                     |
| `user_id`        | `uuid` FK       | Job creator                        |
| `agent_id`       | `uuid` FK       | Target agent (nullable)            |
| `workflow_id`    | `uuid` FK       | Target workflow (nullable)         |
| `trigger_type`   | `text`          | "agent" or "workflow"              |
| `name`           | `text`          | Job name                           |
| `schedule_type`  | `text`          | "cron", "every", or "at"          |
| `schedule_value` | `text`          | Cron expr / minutes / ISO datetime |
| `timezone`       | `text`          | IANA timezone                      |
| `prompt`         | `text`          | Message sent to agent/workflow     |
| `workflow_input` | `jsonb`         | Input passed to workflow trigger    |
| `delivery`       | `jsonb`         | Delivery config                    |
| `enabled`        | `boolean`       | Active flag                        |
| `last_run`       | `timestamptz`   | Last execution time                |
| `last_result`    | `text`          | Last result (truncated to 500ch)   |
| `last_error`     | `text`          | Last error message                 |
| `run_count`      | `integer`       | Total executions                   |
| `created_at`     | `timestamptz`   |                                    |
| `updated_at`     | `timestamptz`   |                                    |

**Indexes:** `(tenant_id)`, `(user_id)`, `(tenant_id, enabled)`

### Database Table: cron_job_runs

| Column           | Type           | Notes                              |
|------------------|----------------|------------------------------------|
| `id`             | `uuid` PK      |                                    |
| `tenant_id`      | `uuid` FK       | Cascade delete                     |
| `cron_job_id`    | `uuid` FK       | Cascade delete                     |
| `status`         | `text`          | "running", "completed", "failed"   |
| `trigger`        | `text`          | "scheduled" or "manual"            |
| `started_at`     | `timestamptz`   |                                    |
| `completed_at`   | `timestamptz`   |                                    |
| `duration_ms`    | `integer`       | nullable                           |
| `result`         | `text`          | Truncated result (500 chars)       |
| `error`          | `text`          | Error message if failed            |
| `created_at`     | `timestamptz`   |                                    |

**Indexes:** `(cron_job_id)`, `(tenant_id)`

### Run History API

`GET /api/cron-jobs/[id]/runs` — paginated list of run records for a job. Returns `{ data, total, page, pageSize, totalPages }`. Ordered by `createdAt DESC`.

### UI Page

**Route:** `/(platform)/scheduled`

- **Job list:** table with name, trigger type (agent/workflow badge), schedule (formatted display: cron expression / "Every N min" / "At datetime"), status toggle, last run, actions.
- **Create/Edit form:** unified `CronJobForm` dialog supporting:
  - Name, trigger type selector (agent/workflow), target selector
  - Schedule type picker (Cron / Every / At) with conditional input fields
  - Prompt textarea
  - Workflow input JSON editor (shown when triggerType=workflow)
- **Edit dialog:** opens pre-filled form for existing job.
- **Run History dialog:** shows paginated table of past runs with status, trigger, started, duration, result/error.
- **Actions:** Edit, Run Now, History, Delete.

---

## 12.6 API Key Management

External API access keys for programmatic agent invocation.

### API Endpoints

| Method | Path                  | Auth (Module, Level) | Description         |
|--------|-----------------------|----------------------|---------------------|
| GET    | `/api/api-keys`       | SETTINGS, 20         | List API keys       |
| POST   | `/api/api-keys`       | SETTINGS, 20         | Create API key      |
| DELETE | `/api/api-keys/[id]`  | SETTINGS, 20         | Revoke API key      |

### Key Generation

**File:** `web/src/lib/api-key-auth.ts`

1. Generate 32 random bytes, base64url-encode.
2. Prefix with `ask_` (format: `ask_{base64url}`).
3. Store SHA-256 hash of full key in DB.
4. Store first 12 characters as `keyPrefix` for identification.
5. Return full key only once on creation (never stored in plaintext).

### Key Authentication

`authenticateApiKey(request)`:
1. Extract `Authorization: Bearer ask_...` header.
2. SHA-256 hash the provided key.
3. Look up by `keyHash` in `api_keys` table.
4. Validate: `isActive=true`, not expired.
5. Update `lastUsedAt` timestamp.
6. Return `{ tenantId, keyId, keyName, scopedAgentIds }`.

### Create Key Validation

| Field           | Validation                     |
|-----------------|--------------------------------|
| `name`          | 1-100 chars                    |
| `scopedAgentIds`| Array of UUIDs, optional       |
| `rateLimitRpm`  | Positive integer, optional     |

### Revoke Key (DELETE)

- Sets `isActive=false` (soft revoke).
- Audit entry: `api_key.revoke`.

### Database Table: api_keys

| Column           | Type           | Notes                             |
|------------------|----------------|-----------------------------------|
| `id`             | `uuid` PK      |                                   |
| `tenant_id`      | `uuid` FK       | Cascade delete                    |
| `name`           | `text`          | Display name                      |
| `key_hash`       | `text`          | SHA-256 hash (unique index)       |
| `key_prefix`     | `text`          | First 12 chars for display        |
| `scoped_agent_ids`| `uuid[]`       | Restrict to specific agents       |
| `rate_limit_rpm` | `integer`       | Requests per minute (default 60)  |
| `expires_at`     | `timestamptz`   | Optional expiry                   |
| `last_used_at`   | `timestamptz`   | Updated on each use               |
| `is_active`      | `boolean`       | Revocation flag                   |
| `created_by`     | `uuid` FK       | Creator user                      |
| `created_at`     | `timestamptz`   |                                   |
| `updated_at`     | `timestamptz`   |                                   |

**Indexes:** `(tenant_id)`, `(key_prefix)`, `UNIQUE(key_hash)`

---

## 12.7 Dashboard

### API Endpoint

| Method | Path                  | Auth (Module, Level) | Description            |
|--------|-----------------------|----------------------|------------------------|
| GET    | `/api/dashboard/stats`   | DASHBOARD, 10        | Aggregated statistics  |
| GET    | `/api/dashboard/activity`| DASHBOARD, 10        | Recent activity feed   |
| GET    | `/api/dashboard/top-agents` | DASHBOARD, 10     | Top agents by usage    |
| GET    | `/api/dashboard/usage` | DASHBOARD, 10        | Usage statistics       |

### Response Shape

```json
{
  "agents": 5,
  "tools": 12,
  "knowledgeBases": 3,
  "connectors": 2,
  "workflows": 4,
  "totalSessions": 1250,
  "sessionsToday": 42,
  "failedToday": 3,
  "costToday": 1.23,
  "totalCostUsd": 45.67,
  "avgCostPerSession": 0.036,
  "topAgents": [
    { "agentId": "...", "agentName": "...", "sessions": 500, "tokens": 125000, "toolCalls": 89, "costUsd": 15.20 }
  ],
  "recentSessions": [
    { "id": "...", "agentName": "...", "status": "completed", "channel": "studio", "totalTurns": 5, "totalToolCalls": 3, "tokens": 2500, "costUsd": 0.05, "createdAt": "..." }
  ]
}
```

### Behavior

- 13 parallel queries for all metrics.
- Counts: active agents, tools, knowledge bases, connectors, workflows.
- Session stats: total, today, failed today.
- Cost: total, today, average per session.
- Cost margin factor from `billing` system config (multiplied to raw costs).
- Top 5 agents by session count with aggregated tokens/tools/cost.
- 10 most recent sessions with status, channel, turns, tokens, cost.

### UI Page

**File:** `web/src/app/(platform)/dashboard/page.tsx`  
**Route:** `/(platform)/dashboard`

- **Header row:** 6 stat cards (Sessions Today, Failed Today, Cost Today, Total Sessions, Total Cost, Avg/Session).
- **Resource row:** 4 mini-stat badges (Agents, Tools, Knowledge Bases, Connectors).
- **Two-column grid:**
  - Left: Top Agents table (Agent, Sessions, Tokens, Cost, Tool Calls).
  - Right: Recent Sessions list (agent name, status badge, channel, turns, tools, tokens, cost, time ago).
- All values formatted with K/M suffixes for large numbers.
- Skeleton loading states for all cards and tables.

---

## 12.8 Documentation Page

Admin-only page serving platform feature documentation from markdown files.

### API Endpoint

| Method | Path         | Auth (Module, Level) | Description                        |
|--------|--------------|----------------------|------------------------------------|
| GET    | `/api/docs`  | DOCS, 10             | List files or get single file content |

**Query parameters:**
- No params: returns file tree `{ files: [{ name, path }] }` from `docs/feature/`.
- `?file=filename.md`: returns `{ content: "markdown string" }` for the specified file.

### File Location

Docs are stored at `<repo-root>/docs/feature/` (tracked in git). Path resolved via `path.resolve(process.cwd(), "../../docs/feature")`.

Additional local-only directories (`docs/_local_research/`, `docs/_local_design-history/`) are gitignored and not served by the API.

### UI Page

**Route:** `/(platform)/docs`  
**Sidebar:** BookText icon under Admin section, requires DOCS module access.

- **Left panel:** file list (clickable sidebar nav).
- **Right panel:** markdown content rendered with proper formatting (headings, code blocks, tables, lists).
- **Loading state:** skeleton placeholder while content loads.

---

## 12.9 Migration Notes

**Migration 011 (`encrypt_secrets.ts`)** is a TypeScript file, not SQL. The SQL-based migration runner (`migrate.ts`) only processes `.sql` files, so migration 011 must be run manually (e.g., via `tsx` or `ts-node`). It will not be auto-applied during normal migration execution.

**Migration 022 (`step_denormalize.sql`):** Adds `node_name` and `node_type` columns to `workflow_run_steps`, drops FK constraint on `workflow_node_id`, grants DOCS access to admin profiles.

**Migration 023 (`cron_job_runs.sql`):** Creates `cron_job_runs` table for scheduled job execution history, adds `workflow_input` JSONB column to `cron_jobs`.
