# Authorization

Comprehensive documentation of authorization in Echol AI Studio. Every feature described here is implemented and traceable to source code.

---

## 1. RBAC Model

### What It Does

Echol AI Studio uses a dual-layer authorization system:

1. **User roles** -- a hierarchical enum (`super_admin > admin > member > viewer`) stored on the `users` table.
2. **Profiles with access rights** -- a module-level permission matrix stored as JSONB on the `profiles` table, linked to users via `profile_id`.

Roles determine what a user *can do structurally* (e.g., create users, assign roles). Profiles determine what *modules* a user can see and manage.

### User Roles

| Role | Rank | Description |
|------|------|-------------|
| `super_admin` | 40 | Full platform access. Can manage all tenants and users. |
| `admin` | 30 | Tenant-level admin. Can manage users, settings, profiles. |
| `member` | 20 | Standard user. Access determined by assigned profile. |
| `viewer` | 10 | Read-only access as determined by assigned profile. |

Defined as a PostgreSQL enum:

```sql
CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'member', 'viewer');
```

### DB Table: `users` (role-related columns)

| Column | Type | Description |
|--------|------|-------------|
| `role` | `user_role` | One of: `super_admin`, `admin`, `member`, `viewer`. Default: `member`. |
| `profile_id` | `UUID` (nullable) | Foreign key to `profiles.id`. `ON DELETE SET NULL`. |

---

## 2. Role Hierarchy Enforcement

### What It Does

When creating or updating a user's role, the system enforces that no user can assign a role equal to or higher than their own. This prevents privilege escalation.

### Implementation

The role hierarchy is enforced in the user creation (`POST /api/users`) and user update (`PATCH /api/users/:id`) routes:

```typescript
const ROLE_RANK: Record<string, number> = {
  super_admin: 40,
  admin: 30,
  member: 20,
  viewer: 10,
};

// Check: target role must be strictly below caller's role
const callerRank = ROLE_RANK[auth.role] ?? 0;
const targetRank = ROLE_RANK[parsed.data.role] ?? 0;
if (targetRank >= callerRank) {
  return errorResponse("Cannot assign role equal to or above your own", "ROLE_ESCALATION", 403);
}
```

### Business Rules

| Rule | Endpoint | Error Code |
|------|----------|------------|
| Cannot assign role >= own rank | `POST /api/users` | `ROLE_ESCALATION` (403) |
| Cannot assign role >= own rank | `PATCH /api/users/:id` | `ROLE_ESCALATION` (403) |
| Cannot change own role | `PATCH /api/users/:id` | `SELF_ROLE_CHANGE` (403) |

**What each role can assign:**

| Caller Role | Can Assign |
|------------|------------|
| `super_admin` (40) | `admin` (30), `member` (20), `viewer` (10) |
| `admin` (30) | `member` (20), `viewer` (10) |
| `member` (20) | `viewer` (10) |
| `viewer` (10) | (none) |

---

## 3. Profiles and Access Rights

### What It Does

Profiles define a permission matrix that controls which platform modules a user can access and at what level. Each module can have one of three permission levels.

### Permission Levels

| Level | Numeric Value | Description |
|-------|--------------|-------------|
| None | `0` | No access to the module |
| View | `10` | Read-only access |
| Manage | `20` | Full read/write access |

### Modules

The system defines 14 modules, organized into sections:

| Module ID | Label | Section |
|-----------|-------|---------|
| `DASHBOARD` | Dashboard | main |
| `AGENTS` | Agents | build |
| `TOOLS` | Tools | build |
| `KNOWLEDGE` | Knowledge Bases | build |
| `WORKFLOWS` | Workflows | build |
| `RUNS` | Sessions | operate |
| `SCHEDULED` | Scheduled Jobs | operate |
| `CONNECTORS` | Connectors | operate |
| `PROVIDERS` | Providers | operate |
| `WORKSPACE` | Workspace | operate |
| `USERS` | Users | admin |
| `AUDIT` | Audit Log | admin |
| `SETTINGS` | Settings | admin |
| `PROFILES` | Profiles | hidden |

### Access Rights Structure

Access rights are stored as JSONB on the `profiles` table. Example:

```json
{
  "DASHBOARD": 10,
  "AGENTS": 20,
  "TOOLS": 20,
  "KNOWLEDGE": 10,
  "WORKFLOWS": 0,
  "CONNECTORS": 0,
  "RUNS": 10,
  "SCHEDULED": 0,
  "PROVIDERS": 10,
  "WORKSPACE": 0,
  "USERS": 0,
  "PROFILES": 0,
  "AUDIT": 10,
  "SETTINGS": 0
}
```

### RBAC Helper Functions

Defined in `packages/auth/src/rbac.ts`:

```typescript
function hasPermission(rights: AccessRights, module: Module, requiredLevel: PermissionLevel): boolean
function canView(rights: AccessRights, module: Module): boolean    // requires level >= 10
function canManage(rights: AccessRights, module: Module): boolean  // requires level >= 20
```

### DB Table: `profiles`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `UUID` | Primary key |
| `tenant_id` | `UUID` | Foreign key to `tenants.id` (CASCADE) |
| `name` | `TEXT` | Profile name (unique per tenant) |
| `description` | `TEXT` | Optional description |
| `access_rights` | `JSONB` | Module permission matrix |
| `is_system` | `BOOLEAN` | System profiles cannot be renamed or deleted |
| `is_active` | `BOOLEAN` | Soft delete flag |
| `created_at` | `TIMESTAMPTZ` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last update timestamp |

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/profiles` | `withRBAC("PROFILES", 10)` | List active profiles for tenant |
| `POST` | `/api/profiles` | `withRBAC("PROFILES", 20)` | Create a new profile |
| `PATCH` | `/api/profiles/:id` | `withRBAC("PROFILES", 20)` | Update profile name, description, or access rights |
| `DELETE` | `/api/profiles/:id` | `withRBAC("PROFILES", 20)` | Soft-delete profile (set `is_active = false`) |

**Create Profile Request:**
```json
{
  "name": "Agent Builder",
  "description": "Can build and manage agents and tools",
  "accessRights": {
    "DASHBOARD": 10,
    "AGENTS": 20,
    "TOOLS": 20,
    "KNOWLEDGE": 20,
    "WORKFLOWS": 20,
    "CONNECTORS": 10,
    "RUNS": 10,
    "SCHEDULED": 0,
    "PROVIDERS": 10,
    "WORKSPACE": 0,
    "USERS": 0,
    "PROFILES": 0,
    "AUDIT": 0,
    "SETTINGS": 0
  }
}
```

### Validation Schemas (Zod)

```typescript
const permissionLevel = z.union([z.literal(0), z.literal(10), z.literal(20)]);

const accessRightsSchema = z.object({
  DASHBOARD: permissionLevel,
  AGENTS: permissionLevel,
  TOOLS: permissionLevel,
  KNOWLEDGE: permissionLevel,
  WORKFLOWS: permissionLevel,
  CONNECTORS: permissionLevel,
  RUNS: permissionLevel,
  SCHEDULED: permissionLevel,
  PROVIDERS: permissionLevel,
  WORKSPACE: permissionLevel,
  USERS: permissionLevel,
  PROFILES: permissionLevel,
  AUDIT: permissionLevel,
  SETTINGS: permissionLevel,
});

// ✅ FIXED: accessRightsSchema now includes all 14 modules (SCHEDULED and
// WORKSPACE were added). The schema validates all modules consistently with
// the MODULES array and default access rights in api-utils.ts.

createProfileSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  accessRights: accessRightsSchema,
});

updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  accessRights: accessRightsSchema.optional(),
});
```

### Security Measures

- **System profile protection:** Profiles with `is_system = true` cannot be renamed or deleted.
- **Tenant isolation:** Profile queries always filter by `tenant_id`.
- **Soft delete:** Profiles are deactivated, not hard-deleted (preserves referential integrity).
- **Unique names per tenant:** Database constraint `UNIQUE(tenant_id, name)`.

---

## 4. Middleware JWT Verification (Edge Runtime)

### What It Does

The Next.js Edge middleware (`web/src/middleware.ts`) intercepts every request and enforces authentication at the platform level before any route handler executes.

### Flow

1. Check if the request path is in `PUBLIC_PATHS` -- if yes, pass through.
2. For `/api/v1/*` routes: skip JWT check (these use API key auth), but apply CORS headers and handle OPTIONS preflight.
3. For all other routes: read the `access_token` cookie.
4. If no token:
   - API routes (`/api/*`) return `401 { error: "Authentication required", code: "UNAUTHENTICATED" }`.
   - UI routes redirect to `/login`.
5. Verify the JWT using `jose.jwtVerify()` with the shared secret, including `issuer: "ais"` and `audience: "ais-app"` validation. The middleware now performs full signature, expiration, issuer, and audience checks at the Edge layer.
6. On success: forward the request with `x-tenant-id`, `x-user-id`, and `x-profile-id` headers set from JWT claims.
7. On failure: return 401 for API routes, redirect to `/login` for UI routes.

### Public Paths (No Auth Required)

```
/login
/forgot-password
/reset-password
/api/auth/login
/api/auth/refresh
/api/auth/password/reset-request
/api/auth/password/reset
/api/auth/otp/verify
/api/health
/embed/
```

### CORS Handling

For `/api/v1/*` routes:
- `OPTIONS` requests get a 204 preflight response with CORS headers.
- Other methods get CORS headers applied to the proxied response.
- Allowed origins are configured via the `CORS_ALLOWED_ORIGINS` environment variable (comma-separated).
- Headers set: `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods` (GET, POST, OPTIONS), `Access-Control-Allow-Headers` (Content-Type, Authorization), `Vary: Origin`.

### Route Matcher

```typescript
matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
```

Excludes Next.js static assets and image files from middleware processing.

---

## 5. `withAuth()` and `withRBAC()` Wrappers

### What They Do

Higher-order functions in `web/src/lib/api-utils.ts` that wrap API route handlers to enforce authentication and authorization.

### `withAuth(handler)`

1. Calls `getAuthContext(request)` to extract and validate the JWT.
2. Checks the `revoked_tokens` table for the token's `jti`.
3. Loads the user from the database and verifies they are active and not locked.
4. Loads the user's profile access rights.
5. Passes the `AuthContext` object to the handler.
6. If any check fails, returns `401 { error: "Authentication required", code: "UNAUTHENTICATED" }`.

### `withRBAC(module, level, handler)`

1. Wraps `withAuth()` -- so all auth checks happen first.
2. Calls `hasPermission(auth.accessRights, module, level)`.
3. If the user lacks the required permission level for the module, returns `403 { error: "Insufficient permissions for {module}", code: "FORBIDDEN" }`.
4. Otherwise, passes through to the handler.

### `AuthContext` Type

```typescript
interface AuthContext {
  userId: string;
  tenantId: string;
  profileId: string;
  role: UserRole;         // "super_admin" | "admin" | "member" | "viewer"
  accessRights: AccessRights;
}
```

### Default Access Rights (No Profile)

If a user has no assigned profile (`profile_id IS NULL`), all module permissions default to `0` (no access):

```typescript
let accessRights: AccessRights = {
  DASHBOARD: 0, AGENTS: 0, TOOLS: 0, KNOWLEDGE: 0, WORKFLOWS: 0,
  CONNECTORS: 0, RUNS: 0, SCHEDULED: 0, PROVIDERS: 0, WORKSPACE: 0,
  USERS: 0, PROFILES: 0, AUDIT: 0, SETTINGS: 0,
};
```

### Usage Examples in Routes

| Endpoint | Wrapper | Module | Level | Effect |
|----------|---------|--------|-------|--------|
| `GET /api/users` | `withRBAC("USERS", 10, ...)` | USERS | View (10) | Must have USERS view permission |
| `POST /api/users` | `withRBAC("USERS", 20, ...)` | USERS | Manage (20) | Must have USERS manage permission |
| `GET /api/profiles` | `withRBAC("PROFILES", 10, ...)` | PROFILES | View (10) | Must have PROFILES view permission |
| `POST /api/profiles` | `withRBAC("PROFILES", 20, ...)` | PROFILES | Manage (20) | Must have PROFILES manage permission |
| `GET /api/api-keys` | `withRBAC("SETTINGS", 20, ...)` | SETTINGS | Manage (20) | Must have SETTINGS manage permission |
| `POST /api/auth/logout` | `withAuth(...)` | (none) | (any) | Just needs valid auth |
| `GET /api/auth/me` | `withAuth(...)` | (none) | (any) | Just needs valid auth |
| `PATCH /api/users/:id/password` | `withAuth(...)` | (none) | (any) | Auth check; then internal `canManage` check for admin flow |

---

## 6. Row-Level Security (RLS)

### What It Does

PostgreSQL Row-Level Security provides a database-level enforcement layer for tenant isolation. Even if application code has a bug that omits a `WHERE tenant_id = ?` clause, RLS prevents cross-tenant data access.

### Implementation (Migration 019)

**Session variable function:**

```sql
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
BEGIN
  RETURN current_setting('app.current_tenant_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
```

**Policy applied to all tenant-scoped tables:**

```sql
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_{table} ON {table}
  USING (tenant_id = current_tenant_id());
```

### Tables with RLS

All 33 tenant-scoped tables have RLS policies:

| Category | Tables |
|----------|--------|
| Agents | `agents`, `agent_tools`, `agent_connectors`, `agent_knowledge_bases`, `agent_sessions`, `agent_session_messages`, `agent_session_tool_calls` |
| API & Auth | `api_keys`, `otp`, `password_history`, `password_reset_requests`, `sessions`, `users` |
| Audit & Config | `audit_log`, `system_config` |
| Build | `connectors`, `cron_jobs`, `tools`, `tool_permissions`, `profiles` |
| Knowledge | `document_chunks`, `documents`, `knowledge_bases` |
| Providers | `provider_models`, `providers` |
| Usage | `usage_records` |
| Workflows | `workflows`, `workflow_edges`, `workflow_nodes`, `workflow_run_steps`, `workflow_runs` |
| Background | `background_tasks`, `progress_spans` |

### FORCE ROW LEVEL SECURITY

The migration uses `FORCE ROW LEVEL SECURITY` which means RLS policies apply even to the table owner (the database role used by the application). This is critical because without `FORCE`, the application's own DB role would bypass RLS.

---

## 7. `withTenantScope()` Helper

### What It Does

A database helper in `packages/database/src/tenant-scope.ts` that sets the PostgreSQL session variable `app.current_tenant_id` before executing queries within a transaction. This activates the RLS policies.

### Implementation

```typescript
export async function withTenantScope<T>(
  tenantId: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
    return fn(tx as unknown as Database);
  });
}
```

### How It Works

1. Opens a database transaction.
2. Executes `SET LOCAL app.current_tenant_id = '{tenantId}'` -- `SET LOCAL` scopes the variable to the current transaction only, preventing leakage.
3. Executes the provided function within that transaction context.
4. RLS policies on all tables automatically filter rows to only those matching the tenant.

### Defense-in-Depth Model

The application uses a "belt-and-suspenders" approach:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Application | `WHERE tenant_id = auth.tenantId` in every query | Primary isolation |
| Database | RLS policies via `withTenantScope()` | Backup isolation (catches bugs) |

---

## 8. Multi-Tenant Isolation Model

### Architecture

Every tenant has a row in the `tenants` table. All data tables include a `tenant_id` column with a foreign key to `tenants.id` with `ON DELETE CASCADE`.

### DB Table: `tenants`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `UUID` | Primary key |
| `name` | `TEXT` | Tenant name |
| `slug` | `TEXT` | URL-safe identifier (unique) |
| `plan` | `TEXT` | Subscription plan (default: "free") |
| `settings` | `JSONB` | Tenant-level configuration |
| `is_active` | `BOOLEAN` | Whether tenant is active |
| `created_at` | `TIMESTAMPTZ` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last update timestamp |

### Isolation Layers

| Layer | How | Where |
|-------|-----|-------|
| JWT claims | `tid` (tenant ID) embedded in access token | `packages/auth/src/jwt.ts` |
| Middleware | `x-tenant-id` header set from JWT for downstream use | `web/src/middleware.ts` |
| Auth context | `auth.tenantId` available in every authenticated handler | `web/src/lib/api-utils.ts` |
| Query filtering | `WHERE tenant_id = auth.tenantId` on every query | Every route handler |
| Database RLS | `current_tenant_id()` PostgreSQL function + policies | Migration 019 |
| User uniqueness | `UNIQUE(tenant_id, email)` -- same email can exist in different tenants | `users` table |
| Profile uniqueness | `UNIQUE(tenant_id, name)` -- same profile name can exist in different tenants | `profiles` table |

### Cross-Tenant Prevention

- Users are scoped to a single tenant via `tenant_id`.
- The JWT `tid` claim is set at login and cannot be changed without re-authentication.
- All RBAC checks and data queries use `auth.tenantId` from the JWT, never from user input.
- Password reset tokens are scoped to the tenant that owns the user.

---

## 9. API Key Authentication for v1 Routes

### What It Does

External API consumers (integrations, SDKs, custom apps) authenticate to the `/api/v1/*` endpoints using bearer token API keys instead of JWT cookies.

### API Key Format

- **Generation:** `ask_` prefix + 32 random bytes (base64url encoded).
- **Example:** `ask_dGhpcyBpcyBhIHRlc3Qga2V5IGZvciB0aGU...`
- **Prefix stored:** First 12 characters stored for display (e.g., `ask_dGhpcyBp`).
- **Hash stored:** Full key is SHA-256 hashed; only the hash is persisted.

### Authentication Flow

1. Extract `Authorization: Bearer ask_...` header.
2. SHA-256 hash the key.
3. Look up the hash in the `api_keys` table.
4. Verify: `is_active = true` and not expired (`expires_at IS NULL OR expires_at > now()`).
5. Update `last_used_at`.
6. Return `ApiKeyAuth` context: `{ tenantId, keyId, keyName, scopedAgentIds }`.

### Agent Scoping

API keys can be scoped to specific agents via the `scoped_agent_ids` array:
- If the array is empty, the key has access to all agents in the tenant.
- If the array contains agent UUIDs, the key can only interact with those agents.
- Enforcement: When creating a session, the v1 route checks if the target agent's ID is in `auth.scopedAgentIds`.

### DB Table: `api_keys`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `UUID` | Primary key |
| `tenant_id` | `UUID` | Foreign key to `tenants.id` (CASCADE) |
| `name` | `TEXT` | Human-readable name |
| `key_hash` | `TEXT` | SHA-256 hash of the full key (unique index) |
| `key_prefix` | `TEXT` | First 12 chars for display |
| `scoped_agent_ids` | `UUID[]` | Array of allowed agent IDs (empty = all) |
| `rate_limit_rpm` | `INTEGER` | Requests per minute limit (default: 60) |
| `expires_at` | `TIMESTAMPTZ` | Optional expiry date |
| `last_used_at` | `TIMESTAMPTZ` | Last usage timestamp |
| `is_active` | `BOOLEAN` | Active status |
| `created_by` | `UUID` | User who created the key |
| `created_at` | `TIMESTAMPTZ` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last update timestamp |

### API Endpoints (Management)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/api-keys` | `withRBAC("SETTINGS", 20)` | List all API keys for tenant |
| `POST` | `/api/api-keys` | `withRBAC("SETTINGS", 20)` | Create a new API key |
| `DELETE` | `/api/api-keys/:id` | `withRBAC("SETTINGS", 20)` | Revoke (soft-delete) an API key |

**Create API Key Request:**
```json
{
  "name": "Production Integration",
  "scopedAgentIds": ["uuid-1", "uuid-2"],
  "rateLimitRpm": 120
}
```

**Create API Key Response:**
```json
{
  "id": "uuid",
  "name": "Production Integration",
  "keyPrefix": "ask_dGhpcyBp",
  "key": "ask_dGhpcyBpcyBhIHRlc3Qga2V5IGZvciB0aGU...",
  "createdAt": "2026-05-15T10:00:00Z"
}
```

The full `key` is returned ONLY on creation. It is never stored or retrievable after this response.

### API Endpoints (Usage - v1)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/agents/:slug/sessions` | API key (Bearer) | Create a new agent session |
| `POST` | `/api/v1/agents/:slug/sessions/:sid/messages` | API key (Bearer) | Send a message to an existing session |
| `GET` | `/api/v1/agents/:slug/sessions/:sid/messages` | API key (Bearer) | Retrieve session message history |

### Security Measures

- **Key never stored:** Only the SHA-256 hash is persisted. The plaintext key is returned once on creation.
- **Prefix for identification:** The `key_prefix` allows users to identify keys without exposing the full value.
- **Soft revocation:** Deleting a key sets `is_active = false` (preserves audit trail).
- **Agent scoping:** Limits blast radius of a compromised key to specific agents.
- **Rate limit field:** `rate_limit_rpm` is stored per key (default 60 RPM); enforcement is available for implementation.
- **Middleware bypass:** `/api/v1/*` routes skip JWT middleware but require API key auth in the route handler itself.
- **CORS:** v1 routes have CORS support via middleware for cross-origin API access.
- **Dead code note:** The v1 route files export their own `OPTIONS` handlers with wildcard CORS (`Access-Control-Allow-Origin: *`). These are effectively dead code because the Edge middleware intercepts `/api/v1/*` OPTIONS requests first and returns its own 204 preflight response with the configured `CORS_ALLOWED_ORIGINS`.
- **Audit logging:** Key creation and revocation are logged. Session creation via API keys is logged with the key name.

### Validation Schema (Zod)

```typescript
createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopedAgentIds: z.array(z.string().uuid()).optional(),
  rateLimitRpm: z.number().int().positive().optional(),
});
```

---

## 10. Client-Side Authorization (AuthContext)

### What It Does

The `AuthProvider` React context (`web/src/lib/auth-context.tsx`) provides client-side authorization state for UI conditional rendering.

### How It Works

1. On mount, fetches `GET /api/auth/me` to load the current user and their access rights.
2. Provides `canView(module)` and `canManage(module)` helper functions.
3. Components use `useAuth()` hook to conditionally show/hide navigation items, buttons, and sections.

### Interface

```typescript
interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  canView: (module: Module) => boolean;   // access_rights[module] >= 10
  canManage: (module: Module) => boolean; // access_rights[module] >= 20
}
```

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth/me` | `withAuth` | Returns current user with profile and access rights |

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "member",
    "avatarUrl": null,
    "settings": {},
    "profileId": "uuid",
    "tenantId": "uuid",
    "lastLoginAt": "2026-05-15T10:00:00Z",
    "profile": {
      "id": "uuid",
      "name": "Agent Builder",
      "accessRights": { "DASHBOARD": 10, "AGENTS": 20, ... }
    },
    "accessRights": { "DASHBOARD": 10, "AGENTS": 20, ... }
  }
}
```

---

## 11. User Management Authorization

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/users` | `withRBAC("USERS", 10)` | List users (paginated, searchable). Supports `?showAll=true` query param to include deactivated users. |
| `POST` | `/api/users` | `withRBAC("USERS", 20)` | Create user (with role hierarchy check) |
| `GET` | `/api/users/:id` | `withRBAC("USERS", 10)` | Get user details with profile |
| `PATCH` | `/api/users/:id` | `withRBAC("USERS", 20)` | Update user (with role hierarchy check) |
| `POST` | `/api/users/:id/deactivate` | `withRBAC("USERS", 20)` | Soft-deactivate a user |
| `POST` | `/api/users/:id/reactivate` | `withRBAC("USERS", 20)` | Reactivate a deactivated user |
| `PATCH` | `/api/users/:id/password` | `withAuth` | Change password (self or admin) |

### Deactivation Rules

- Cannot deactivate your own account (`SELF_DEACTIVATION` error).
- Deactivation sets `is_active = false` and `deactivated_at = now()`.
- Deactivated users cannot log in or refresh tokens.
- Reactivation restores `is_active = true` and clears `deactivated_at`.

### Validation Schemas (Zod)

```typescript
createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(12).max(128),
  role: z.enum(["super_admin", "admin", "member", "viewer"]).default("member"),
  profileId: z.string().uuid().optional(),
});

updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.enum(["super_admin", "admin", "member", "viewer"]).optional(),
  profileId: z.string().uuid().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
});
```

---

## 12. Authorization Summary Matrix

### Route-Level Authorization

| Route Pattern | Auth Method | Module | Level | Additional Checks |
|---------------|------------|--------|-------|-------------------|
| `POST /api/auth/login` | Public | -- | -- | Rate limit |
| `POST /api/auth/otp/verify` | Public | -- | -- | Rate limit. ~~Known gap~~ **Fixed:** now checks `isLocked` on the user before completing OTP verification — locked users are rejected. |
| `POST /api/auth/refresh` | Refresh token | -- | -- | Session validity |
| `POST /api/auth/password/reset-request` | Public | -- | -- | -- |
| `POST /api/auth/password/reset` | Token | -- | -- | Token validity |
| `GET /api/auth/me` | JWT | -- | -- | -- |
| `POST /api/auth/logout` | JWT | -- | -- | -- |
| `GET /api/users` | JWT + RBAC | USERS | 10 | Tenant scoping |
| `POST /api/users` | JWT + RBAC | USERS | 20 | Role hierarchy |
| `PATCH /api/users/:id` | JWT + RBAC | USERS | 20 | Role hierarchy, self-change prevention |
| `POST /api/users/:id/deactivate` | JWT + RBAC | USERS | 20 | Self-deactivation prevention |
| `POST /api/users/:id/reactivate` | JWT + RBAC | USERS | 20 | -- |
| `PATCH /api/users/:id/password` | JWT | -- | -- | Self: current password; Admin: USERS manage |
| `GET /api/profiles` | JWT + RBAC | PROFILES | 10 | Tenant scoping |
| `POST /api/profiles` | JWT + RBAC | PROFILES | 20 | Name uniqueness |
| `PATCH /api/profiles/:id` | JWT + RBAC | PROFILES | 20 | System profile protection |
| `DELETE /api/profiles/:id` | JWT + RBAC | PROFILES | 20 | System profile protection |
| `GET /api/api-keys` | JWT + RBAC | SETTINGS | 20 | Tenant scoping |
| `POST /api/api-keys` | JWT + RBAC | SETTINGS | 20 | -- |
| `DELETE /api/api-keys/:id` | JWT + RBAC | SETTINGS | 20 | Tenant scoping |
| `GET /api/audit-log` | JWT + RBAC | AUDIT | 10 | Tenant scoping, paginated, filterable by action/userId/date range |
| `POST /api/v1/agents/:slug/sessions` | API key | -- | -- | Agent scoping |
| `POST /api/v1/.../messages` | API key | -- | -- | Session ownership |
| `GET /api/v1/.../messages` | API key | -- | -- | Tenant scoping |

### Utility Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `withAuth(handler)` | `web/src/lib/api-utils.ts` | JWT verification + revocation check + user validation |
| `withRBAC(module, level, handler)` | `web/src/lib/api-utils.ts` | withAuth + module permission check |
| `getAuthContext(request)` | `web/src/lib/api-utils.ts` | Extract full auth context from request |
| `hasPermission(rights, module, level)` | `packages/auth/src/rbac.ts` | Check if access rights grant required level |
| `canView(rights, module)` | `packages/auth/src/rbac.ts` | Shorthand for `hasPermission(_, _, 10)` |
| `canManage(rights, module)` | `packages/auth/src/rbac.ts` | Shorthand for `hasPermission(_, _, 20)` |
| `authenticateApiKey(request)` | `web/src/lib/api-key-auth.ts` | API key bearer token verification |
| `withTenantScope(tenantId, fn)` | `packages/database/src/tenant-scope.ts` | Set RLS session variable for tenant isolation |
| `escapeLike(input)` | `web/src/lib/api-utils.ts` | Escape LIKE/ILIKE wildcards to prevent injection |
| `errorResponse(message, code, status)` | `web/src/lib/api-utils.ts` | Standardized JSON error response with `{ error, code }` shape |
| `parseJsonBody(request)` | `web/src/lib/api-utils.ts` | Safe JSON body parser — returns `null` instead of throwing on invalid/missing body |

---

## 13. Access Rights Hash (Cache Invalidation)

### What It Does

The JWT contains an `arh` (access rights hash) claim -- a SHA-256 hash of the user's profile access rights at the time the token was issued. This enables detecting stale permissions.

### How It Works

1. On login/refresh, the access rights JSON is sorted by key and SHA-256 hashed.
2. The hash is embedded in the JWT as the `arh` claim.
3. When a profile's access rights are updated, the hash in existing JWTs no longer matches the current profile state.
4. The system can compare the token's `arh` with the current hash to detect and handle stale permissions.

### Implementation

```typescript
const sorted = JSON.stringify(profile.accessRights, Object.keys(profile.accessRights).sort());
accessRightsHash = createHash("sha256").update(sorted).digest("hex");
```

This hash is computed identically in the login route, OTP verify route, and refresh route.
