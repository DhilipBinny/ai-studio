-- 018: Token revocation for JWT invalidation
-- Enables revoking compromised tokens before expiry

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id BIGSERIAL PRIMARY KEY,
  jti VARCHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(50) NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_revoked_tokens_jti ON revoked_tokens(jti);
CREATE INDEX idx_revoked_tokens_expires ON revoked_tokens(expires_at);
