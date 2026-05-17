# Authentication

Comprehensive documentation of authentication in Kairo Studio. Every feature described here is implemented and traceable to source code.

---

## 1. Login Flow (Email/Password to JWT)

### What It Does

Users authenticate with email and password. The system validates credentials against Argon2id hashes stored in the `users` table. On success (without 2FA), the server issues a short-lived JWT access token and an opaque refresh token as HttpOnly cookies. The client is redirected to `/dashboard`.

### Business Rules

- Email lookup is case-sensitive (uses `eq()` on the `email` column).
- Inactive users (`is_active = false`) and locked users (`is_locked = true`) are rejected with a generic "Invalid email or password" message -- no user enumeration.
- On successful login, `failed_login_attempts` resets to 0 and `last_login_at` is updated.
- If 2FA is enabled for the tenant (via `system_config` key `auth`, field `enable_2fa`), the login endpoint returns a `{ requires_otp: true, etus: "..." }` response instead of tokens. The client then transitions to the OTP verification screen.

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | Public | Authenticate with email/password |

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (no 2FA):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "member"
  }
}
```
Plus `access_token` and `refresh_token` cookies set in the response headers.

**Response (2FA enabled):**
```json
{
  "requires_otp": true,
  "etus": "uuid-session-token"
}
```

### DB Tables

| Table | Key Columns Used |
|-------|-----------------|
| `users` | `id`, `tenant_id`, `profile_id`, `email`, `password_hash`, `role`, `is_active`, `is_locked`, `failed_login_attempts`, `otp_request_count`, `otp_blocked_until`, `last_login_at` |
| `profiles` | `id`, `access_rights` |
| `sessions` | `tenant_id`, `user_id`, `token_hash`, `ip_address`, `user_agent`, `expires_at` |
| `system_config` | `tenant_id`, `key` (= "auth"), `value` (JSON with `enable_2fa`, `otp_max_resend`, `otp_block_duration_minutes`) |

### Security Measures

- **Rate limiting:** In-memory `RateLimiter` -- 5 attempts per 15 minutes per `login:{ip}:{email}` key.
- **Generic error messages:** Never reveals whether email exists or password is wrong.
- **Argon2id hashing:** `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`, `outputLen: 32`.
- **Audit logging:** Every login (success) and failed login (with attempt count) is recorded.

### UI Page

| Route | Component | Key Interactions |
|-------|-----------|-----------------|
| `/login` | `(auth)/login/page.tsx` | Email/password form with client-side validation. On 2FA, transitions to OTP input screen. "Forgot password?" link below form. |

### Validation Schema (Zod)

```typescript
loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
```

---

## 2. JWT Structure

### What It Does

Access tokens are HS256 JWTs signed with the `jose` library. They encode the user's identity, tenant, profile, role, and an access-rights hash for cache-invalidation detection.

### Claims

| Claim | Field | Description |
|-------|-------|-------------|
| `sub` | `userId` | User UUID |
| `tid` | `tenantId` | Tenant UUID |
| `pid` | `profileId` | Profile UUID (empty string if none) |
| `rol` | `role` | User role (`super_admin`, `admin`, `member`, `viewer`) |
| `arh` | `accessRightsHash` | SHA-256 hash of the sorted access rights JSON |
| `jti` | (auto-generated) | 16-byte random hex string for token revocation |
| `iat` | (auto) | Issued-at timestamp |
| `exp` | (auto) | Expiration timestamp (15 minutes from issuance) |
| `iss` | `"ais"` | Issuer |
| `aud` | `"ais-app"` | Audience |

### Token Signing

```typescript
new SignJWT({ sub, tid, pid, rol, arh, jti })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setIssuer("ais")
  .setAudience("ais-app")
  .setExpirationTime("15m")
  .sign(secret);
```

### Security

- `JWT_SECRET` must be at least 32 characters.
- Token verification validates both issuer (`ais`) and audience (`ais-app`) at both the middleware and route-handler levels.
- The `arh` (access rights hash) allows the system to detect stale permissions when a profile's access rights are changed.

### Dual Verification Model

There are two JWT verification points, both now validating issuer and audience:

| Verification Point | Location | Issuer/Audience Check | Purpose |
|---|---|---|---|
| **Edge middleware** | `web/src/middleware.ts` | **Yes** -- calls `jwtVerify()` with `issuer: "ais"` and `audience: "ais-app"` | Fast gate-check: rejects expired/invalid signatures, validates issuer + audience, sets `x-tenant-id`/`x-user-id`/`x-profile-id` headers |
| **Route handler** | `verifyAccessToken()` in `api-utils.ts` | **Yes** -- validates `iss: "ais"` and `aud: "ais-app"` | Full verification: issuer, audience, revocation check, user active/locked status |

Every authenticated API request passes through **both** layers. Both layers now validate issuer and audience. The middleware provides the first gate at the Edge runtime, and the route-handler wrapper (`withAuth` / `withRBAC`) adds JTI revocation lookup and user status checks.

---

## 2a. `parseJsonBody` Helper

### What It Does

A safe JSON body parser (`parseJsonBody` in `web/src/lib/api-utils.ts`) that wraps `request.json()` in a try/catch. If the request body is missing, empty, or contains invalid JSON, it returns `null` instead of throwing an exception. This prevents unhandled crashes from malformed requests reaching any API route.

**Signature:**
```typescript
async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null>
```

**Usage:** All POST/PATCH/DELETE route handlers call `parseJsonBody(request)` before Zod validation. If it returns `null`, the route returns a 400 error with `"Invalid or missing request body"`.

---

## 3. Token Refresh Flow

### What It Does

Before the 15-minute access token expires, the client can obtain a new access token + refresh token pair by presenting the current refresh token. This implements **refresh token rotation** -- the old refresh token is revoked on every use.

### Business Rules

1. The refresh token cookie is read from the request.
2. Its SHA-256 hash is looked up in the `sessions` table.
3. The session must not be revoked (`revoked_at IS NULL`) and not expired.
4. The old session is revoked immediately (set `revoked_at`).
5. The user is re-validated (must be active and not locked).
6. A new access token is signed with fresh profile access rights.
7. A new refresh token is generated and stored as a new session row.
8. Both new tokens are set as cookies in the response.

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/refresh` | Refresh token cookie | Exchange refresh token for new token pair |

**Request:** No body. The refresh token is read from the `refresh_token` cookie.

**Response:**
```json
{ "success": true }
```
Plus new `access_token` and `refresh_token` cookies.

### DB Tables

| Table | Key Columns Used |
|-------|-----------------|
| `sessions` | `token_hash`, `revoked_at`, `expires_at`, `user_id`, `tenant_id` |
| `users` | `id`, `is_active`, `is_locked`, `profile_id`, `role` |
| `profiles` | `access_rights` |

### Security Measures

- **Rotation:** Each refresh token is single-use. The old token is revoked before issuing a new one.
- **Reuse detection:** If a revoked refresh token is presented, lookup returns no valid session, blocking the request.
- **Re-validation:** User status (active, locked) is checked on every refresh, enabling real-time access revocation.
- **Session expiry:** Refresh tokens expire after 7 days.

---

## 4. OTP / 2FA

### What It Does

When a tenant has `enable_2fa = true` in their `system_config` (key `auth`), the login flow becomes two-step:

1. **Step 1 (Login):** Validate email/password. If valid, generate a 6-digit OTP, hash it with SHA-256, store it in the `otp` table, email the plaintext code to the user, and return `{ requires_otp: true, etus }`.
2. **Step 2 (Verify):** The client submits the `etus` (ephemeral token UUID session) and the 6-digit OTP. The server verifies using timing-safe comparison of SHA-256 hashes. On success, tokens are issued.

### Business Rules

- OTP codes are 6-digit zero-padded random integers (0-999999).
- OTP validity: 5 minutes.
- Previous active OTPs for the user are deactivated before generating a new one.
- **Resend throttling:** Users are limited to `otp_max_resend` (default 5) OTP requests. After exceeding, the user is blocked for `otp_block_duration_minutes` (default 30 minutes) via the `otp_blocked_until` field.
- OTP request count resets to 0 on successful verification.
- The `etus` field is a UUID that ties the OTP verification to a specific login attempt.

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | Public | Initiates OTP flow when 2FA enabled |
| `POST` | `/api/auth/otp/verify` | Public | Verifies OTP code and issues tokens |

**OTP Verify Request:**
```json
{
  "etus": "uuid-session-token",
  "otp": "123456"
}
```

**OTP Verify Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "member"
  }
}
```
Plus `access_token` and `refresh_token` cookies.

### DB Tables

| Table | Key Columns |
|-------|------------|
| `otp` | `id`, `tenant_id`, `user_id`, `etus` (unique), `otp_code` (SHA-256 hash), `expires_at`, `is_active` |
| `users` | `otp_request_count`, `otp_blocked_until` |

### Security Measures

- **Hashed storage:** OTP codes are SHA-256 hashed before storage. Plaintext is never persisted.
- **Timing-safe comparison:** `crypto.timingSafeEqual` prevents timing attacks on OTP verification.
- **Rate limiting:** Separate `RateLimiter` instance -- 5 attempts per 15 minutes per `otp:{etus}` key.
- **Resend throttling:** After exceeding max resends, user is blocked for 30 minutes.
- **Single-use:** OTP is deactivated immediately after successful verification.
- **Expiry:** 5-minute validity window.
- **Audit logging:** Successful OTP login is recorded with `{ method: "otp" }`.

### Validation Schema (Zod)

```typescript
otpVerifySchema = z.object({
  etus: z.string().min(1, "Session token is required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});
```

### UI

The login page (`/login`) has a `LoginState` type that cycles through `"credentials" | "otp" | "loading"`. When the login API returns `requires_otp: true`, the form switches to a 6-digit numeric input with monospace tracking. A "Back to login" button allows the user to return to credentials.

---

## 5. Password Reset

### What It Does

A two-step password reset flow:

1. **Request:** User submits their email. A random 32-byte hex token is generated, SHA-256 hashed, and stored in `password_reset_requests`. A branded email with a reset link is sent.
2. **Reset:** User submits the token and new password. The system validates the token, checks password strength, breach status, and history, then updates the password.

### Business Rules

- **Request step:** Always returns `{ success: true }` regardless of whether the email exists (prevents user enumeration).
- **Token expiry:** 30 minutes (`AUTH_CONFIG.password.resetTokenExpiryMinutes`).
- **Single-use:** Tokens are marked with `used_at` timestamp after use.
- **On reset:**
  - Password is validated with `validatePassword()` (zxcvbn strength check).
  - Password is checked against HIBP breach database.
  - Password is checked against the last 5 password hashes in `password_history`.
  - All active sessions for the user are revoked.
  - Account lockout is cleared (`is_locked = false`, `failed_login_attempts = 0`).
  - `require_password_change` is set to `false`.

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/password/reset-request` | Public | Request a password reset email |
| `POST` | `/api/auth/password/reset` | Public (token-based) | Reset password with token |

**Reset Request:**
```json
{ "email": "user@example.com" }
```

**Reset Response (always):**
```json
{ "success": true }
```

**Password Reset Request:**
```json
{
  "token": "64-char-hex-string",
  "newPassword": "newSecurePassword"
}
```

**Password Reset Response:**
```json
{ "success": true }
```

### DB Tables

| Table | Key Columns |
|-------|------------|
| `password_reset_requests` | `id`, `tenant_id`, `user_id`, `token_hash` (unique), `expires_at`, `used_at` |
| `password_history` | `id`, `tenant_id`, `user_id`, `password_hash`, `created_at` |
| `users` | `password_hash`, `password_changed_at`, `failed_login_attempts`, `is_locked`, `locked_at`, `require_password_change` |
| `sessions` | `revoked_at` (all user sessions revoked on reset) |

### Security Measures

- **Token hashing:** The reset token is SHA-256 hashed before storage. The raw token is sent in the email URL; only the hash is persisted.
- **No user enumeration:** The request endpoint always returns success.
- **All sessions revoked:** On password reset, every active session for the user is invalidated.
- **Unlocks account:** Password reset clears the lockout state.

### Validation Schemas (Zod)

```typescript
passwordResetRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
});

passwordResetSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be at most 128 characters"),
});
```

### UI Pages

| Route | Component | Key Interactions |
|-------|-----------|-----------------|
| `/forgot-password` | `(auth)/forgot-password/page.tsx` | Email input form. On success, shows confirmation with "Check your email" message and 30-minute expiry notice. |
| `/reset-password` | `(auth)/reset-password/page.tsx` | Reads `?token=` from URL. Uses `<PasswordInput>` component with real-time strength meter and breach check. On success, shows confirmation with "Sign in with new password" button. |

---

## 6. Password Policy

### What It Does

A multi-layer password strength validation system combining length requirements, entropy scoring (zxcvbn), breach database checks (HIBP), and history enforcement.

### Rules

| Rule | Value | Enforcement Point |
|------|-------|-------------------|
| Minimum length | 12 characters | Zod schema + `validatePassword()` + `hashPassword()` |
| Maximum length | 128 characters | Zod schema + `validatePassword()` + `hashPassword()` |
| Minimum strength score | 3 (out of 4) | `validatePassword()` using zxcvbn |
| History check depth | Last 5 passwords | `checkPasswordHistory()` |
| Breach database | HIBP k-anonymity API | `checkBreached()` |

### Strength Scoring (zxcvbn)

The system uses `@zxcvbn-ts/core` with English language dictionaries and common adjacency graphs. Scores range from 0-4:

| Score | Label (UI) | Color |
|-------|-----------|-------|
| 0 | Weak | Red |
| 1 | Weak | Red |
| 2 | Fair | Amber |
| 3 | Good | Green |
| 4 | Strong | Emerald |

Passwords must score >= 3 ("Good" or "Strong") to pass.

### Breach Check (HIBP)

Uses the k-anonymity range API (`https://api.pwnedpasswords.com/range/{prefix}`):
1. SHA-1 hash the password.
2. Send the first 5 characters of the hash to HIBP.
3. Check if the remaining suffix appears in the response.
4. **Server-side** (`checkBreached()` in `packages/auth`): Uses `Add-Padding: true` header for enhanced privacy.
5. **Client-side** (`PasswordInput` component): Does **NOT** include the `Add-Padding: true` header on HIBP checks -- the client-side breach check is a UX preview only; server-side always re-validates with padding.
6. On API failure, defaults to `{ breached: false }` (fail-open for availability).

### Password History

- Stores Argon2id hashes in `password_history` table.
- On password change/reset, checks the new password against the last 5 stored hashes using `verifyPassword()`.
- Error message: "Password was used recently. Choose a password you haven't used in your last 5 changes."

### Where Enforced

| Context | Strength | Breach | History |
|---------|----------|--------|---------|
| User creation (`POST /api/users`) | Yes | Yes | N/A (new user, but initial hash is inserted into `password_history`) |
| Password reset (`POST /api/auth/password/reset`) | Yes | Yes | Yes |
| Self password change (`PATCH /api/users/:id/password`) | Yes | Yes | Yes |
| Admin password reset (`PATCH /api/users/:id/password`) | Yes | Yes | No |

### UI Component

The `<PasswordInput>` component (`src/components/password-input.tsx`) provides:
- Real-time strength meter (4 color bars).
- Requirements checklist (length, strength).
- Live breach database check with 800ms debounce.
- Show/hide password toggle.
- zxcvbn feedback (warnings and suggestions).

### Client-Side Password Policy Constants

Password policy constants (min length, max length, min strength score, strength labels) are duplicated for client-side use in `web/src/lib/client-config.ts`. This avoids importing from the server-only `packages/auth` package in `"use client"` components. Any change to `AUTH_CONFIG.password` must be mirrored in `client-config.ts`.

---

## 7. Logout (Token Revocation)

### What It Does

Logout performs a complete session teardown: revokes the refresh token session, revokes the access token by JTI, clears both cookies, and creates an audit log entry.

### Business Rules

1. The refresh token's SHA-256 hash is looked up in `sessions` and marked as revoked.
2. The access token is verified to extract its `jti` claim.
3. The `jti` is inserted into the `revoked_tokens` table with reason `"logout"` and the token's original expiry.
4. Both `access_token` and `refresh_token` cookies are deleted from the response.
5. If either token is missing or invalid, the operation continues gracefully (no error thrown).

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/logout` | `withAuth` (access token required) | Revoke tokens and clear cookies |

**Response:**
```json
{ "success": true }
```

### DB Tables

| Table | Key Columns |
|-------|------------|
| `sessions` | `token_hash`, `revoked_at` |
| `revoked_tokens` | `jti` (unique, VARCHAR 64), `user_id`, `reason`, `revoked_at`, `expires_at` |

**`revoked_tokens` Schema:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL` | Auto-increment primary key |
| `jti` | `VARCHAR(64)` | JWT ID claim (unique index) |
| `user_id` | `UUID` | Foreign key to `users.id` (CASCADE) |
| `reason` | `VARCHAR(50)` | Revocation reason (e.g., `"logout"`) |
| `revoked_at` | `TIMESTAMPTZ` | When revoked (defaults to `now()`) |
| `expires_at` | `TIMESTAMPTZ` | Original token expiry (for cleanup) |

### Token Revocation Check

On every authenticated request, `getAuthContext()` in `api-utils.ts`:
1. Verifies the access token.
2. If the token has a `jti`, queries `revoked_tokens` to check if it has been revoked.
3. If revoked, returns `null` (unauthenticated).

This enables immediate session invalidation even for unexpired access tokens.

### Security Measures

- **Belt-and-suspenders:** Both the stateless JWT and the stateful session are invalidated.
- **`onConflictDoNothing`:** Prevents errors if the same JTI is revoked twice.
- **Expiry tracking:** The `expires_at` column enables periodic cleanup of expired revocation records.
- **Audit trail:** Logout events are recorded with IP and user agent.

---

## 8. Cookie Security

### Configuration

Both `access_token` and `refresh_token` cookies use these settings:

| Attribute | `access_token` | `refresh_token` |
|-----------|----------------|-----------------|
| `httpOnly` | `true` | `true` |
| `secure` | `true` in production | `true` in production |
| `sameSite` | `strict` | `strict` |
| `path` | `/` | `/api/auth/refresh` |
| `maxAge` | `900` (15 minutes) | `604800` (7 days) |

### Design Decisions

- **HttpOnly:** Prevents JavaScript access, mitigating XSS token theft.
- **Secure:** Only sent over HTTPS in production. Disabled in development (HTTP on localhost:3099).
- **SameSite=Strict:** Prevents CSRF by not sending cookies on cross-origin requests.
- **Path restriction:** The refresh token is scoped to `/api/auth/refresh` only, so it is never sent to other API endpoints, reducing exposure surface.
- **Short access token:** 15-minute lifetime limits the window of a stolen token.

---

## 9. Account Lockout

### What It Does

After 10 consecutive failed login attempts, the user's account is locked. Locked users cannot log in until their account is unlocked via password reset or admin action.

### Business Rules

- **Threshold:** 10 failed attempts (`AUTH_CONFIG.lockout.maxFailedAttempts`).
- **Counting:** `failed_login_attempts` is incremented on each failed password verification.
- **Lock trigger:** When `failed_login_attempts >= 10`, the system sets `is_locked = true` and records `locked_at = now()`.
- **Locked response:** Locked users receive the same generic "Invalid email or password" message (no lockout disclosure).
- **Unlock via password reset:** The password reset flow (`POST /api/auth/password/reset`) clears the lockout: sets `is_locked = false`, `locked_at = null`, and `failed_login_attempts = 0`.
- **Successful login resets counter:** On successful login, `failed_login_attempts` is set to 0.

### DB Columns on `users`

| Column | Type | Description |
|--------|------|-------------|
| `failed_login_attempts` | `integer` | Counter, default 0 |
| `is_locked` | `boolean` | Lock status, default false |
| `locked_at` | `timestamptz` | When locked (nullable) |

### Security Measures

- **No time-based auto-unlock:** Accounts stay locked until explicitly unlocked via password reset or admin reactivation.
- **Audit logging:** Failed login attempts are recorded with the current attempt count.
- **Rate limiting still applies:** Even before lockout triggers, the rate limiter (5 per 15 min) slows down brute force.

---

## 10. Password Change (Authenticated)

### What It Does

Authenticated users can change their own password (requires current password) or admins can reset another user's password (no current password required).

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PATCH` | `/api/users/:id/password` | `withAuth` | Change or reset password |

### Self-Change Flow

1. User provides `currentPassword` and `newPassword`.
2. Current password is verified against stored hash.
3. New password is validated (strength + breach + history).
4. Password hash is updated. `password_changed_at` is set. `require_password_change` is cleared.
5. New hash is added to `password_history`.
6. All active sessions for the user are revoked.

### Admin-Reset Flow

1. Admin provides only `newPassword` (no current password needed).
2. Caller must have `USERS` manage permission (`canManage(auth.accessRights, "USERS")`).
3. New password is validated (strength + breach; history is NOT checked for admin resets).
4. Password hash is updated. `require_password_change` is set to `true` (forces user to change on next login).
5. New hash is added to `password_history`.
6. All active sessions for the user are revoked.

### Validation Schema (Zod)

```typescript
changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be at most 128 characters"),
});
```

---

## 11. Audit Trail for Authentication Events

Every authentication action creates a tamper-evident audit log entry. The audit system uses a hash chain (each entry includes the hash of the previous entry) computed via `computeAuditHash()`.

### Logged Actions

| Action | Trigger | Details |
|--------|---------|---------|
| `auth.login` | Successful login (direct or OTP) | `{ email, role }` or `{ method: "otp" }` |
| `auth.login_failed` | Wrong password | `{ reason: "invalid_password", attempts: N }` |
| `auth.logout` | Logout | `{ sessionRevoked: boolean }` |
| `auth.password_reset_request` | Reset email sent | `{}` |
| `auth.password_reset` | Password reset completed | `{}` |
| `user.password_change` | Password changed | `{ changedBy: "self" | "admin", sessionsRevoked: true }` |

### DB Table: `audit_log`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL` | Auto-increment primary key |
| `tenant_id` | `UUID` | Tenant isolation |
| `user_id` | `UUID` | Who performed the action (nullable) |
| `action` | `TEXT` | Action identifier |
| `resource_type` | `TEXT` | Resource type (nullable) |
| `resource_id` | `TEXT` | Resource identifier (nullable) |
| `details` | `JSONB` | Action-specific details |
| `ip_address` | `INET` | Client IP |
| `user_agent` | `TEXT` | Browser/client user agent |
| `prev_hash` | `TEXT` | Hash of the previous audit entry |
| `entry_hash` | `TEXT` | SHA-256 hash of this entry (hash chain) |
| `created_at` | `TIMESTAMPTZ` | Timestamp |

---

## 12. Configuration Constants

All authentication configuration is centralized in `packages/auth/src/config.ts`:

```typescript
AUTH_CONFIG = {
  jwt: {
    accessTokenExpiry: "15m",
    accessTokenMaxAge: 900,        // seconds
    refreshTokenDays: 7,
    refreshTokenMaxAge: 604800,    // seconds
    minSecretLength: 32,
  },
  password: {
    minLength: 12,
    maxLength: 128,
    minStrength: 3,                // zxcvbn score
    historyCount: 5,
    resetTokenExpiryMinutes: 30,
  },
  otp: {
    validitySeconds: 300,          // 5 minutes
    maxResend: 5,
    blockDurationMinutes: 30,
  },
  rateLimit: {
    loginAttempts: 5,
    loginWindowMs: 900000,         // 15 minutes
  },
  lockout: {
    maxFailedAttempts: 10,
  },
};
```

---

## 13. Encryption (Provider Secrets)

While not strictly authentication, the encryption module (`packages/auth/src/encryption.ts`) is exported from the auth package and used to encrypt provider API keys at rest.

- **Algorithm:** AES-256-GCM with 12-byte random IV.
- **Key rotation:** Supports versioned keys via `ENCRYPTION_KEY_V{n}` environment variables. Current version controlled by `ENCRYPTION_KEY_VERSION`.
- **Format:** `v{version}:{iv_base64}:{ciphertext_base64}:{auth_tag_base64}`.
- **Detection:** `isEncrypted()` validates the format via regex.
