export function filterOutput(text: string): string {
  let filtered = text;

  filtered = filtered.replace(/ais_sk_[a-f0-9]{64}/g, 'ais_sk_***REDACTED***');
  filtered = filtered.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***REDACTED***');
  filtered = filtered.replace(/ant-[a-zA-Z0-9-]{20,}/g, 'ant-***REDACTED***');
  filtered = filtered.replace(/Bearer\s+[a-zA-Z0-9._\-/+=]{20,}/gi, 'Bearer ***REDACTED***');
  filtered = filtered.replace(/eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, '***JWT_REDACTED***');
  filtered = filtered.replace(/(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^\s"']+/gi, '***DB_URL_REDACTED***');
  filtered = filtered.replace(/(?:oauth|access_token|refresh_token)[=:]\s*["']?[a-zA-Z0-9._\-/+=]{20,}/gi, '***OAUTH_REDACTED***');
  filtered = filtered.replace(/AKIA[0-9A-Z]{16}/g, '***AWS_KEY_REDACTED***');
  filtered = filtered.replace(/AIza[0-9A-Za-z_-]{35}/g, '***GCLOUD_KEY_REDACTED***');
  filtered = filtered.replace(/ghp_[0-9a-zA-Z]{36}/g, '***GITHUB_TOKEN_REDACTED***');
  filtered = filtered.replace(/gho_[0-9a-zA-Z]{36}/g, '***GITHUB_TOKEN_REDACTED***');
  filtered = filtered.replace(/ghs_[0-9a-zA-Z]{36}/g, '***GITHUB_TOKEN_REDACTED***');
  filtered = filtered.replace(/github_pat_[0-9a-zA-Z_]{22,}/g, '***GITHUB_PAT_REDACTED***');
  filtered = filtered.replace(/xox[bporas]-[0-9a-zA-Z-]{10,}/g, '***SLACK_TOKEN_REDACTED***');
  filtered = filtered.replace(/sk_live_[0-9a-zA-Z]{24,}/g, '***STRIPE_KEY_REDACTED***');
  filtered = filtered.replace(/pk_live_[0-9a-zA-Z]{24,}/g, '***STRIPE_KEY_REDACTED***');
  filtered = filtered.replace(/-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----[\s\S]*?-----END\s(?:RSA\s)?PRIVATE\sKEY-----/g, '***PRIVATE_KEY_REDACTED***');
  filtered = filtered.replace(
    /(?:password|secret|token|apikey|api_key|private_key|auth_token)\s*[=:]\s*["']?[^\s"']{8,}/gi,
    (match) => {
      const parts = match.split(/[=:]/);
      return parts[0] + '=***REDACTED***';
    },
  );

  return filtered;
}

export function checkOutputSafety(text: string): { safe: boolean; flags: string[] } {
  const flags: string[] = [];

  if (/(?:curl|wget|fetch)\s+https?:\/\/[^\s]+.*(?:api_key|token|secret)/i.test(text)) {
    flags.push('potential_data_exfiltration');
  }

  if (/rm\s+-rf\s+\/(?!\s|$)/i.test(text)) {
    flags.push('destructive_command');
  }

  if (/(?:i\s+now\s+have|i\s+am\s+now\s+in|entering|switched\s+to)\s+(?:admin|root|unrestricted|debug|developer)\s+(?:mode|access|privileges)/i.test(text)) {
    flags.push('false_privilege_claim');
  }

  if (/(?:write_file|edit_file)\s*.*(?:IDENTITY\.md|RULES\.md|SOUL\.md)/i.test(text)) {
    flags.push('system_file_modification');
  }

  if (/(?:send|share|paste|give)\s+(?:me\s+)?(?:your\s+)?(?:api\s*key|password|token|secret|credentials|private\s*key)/i.test(text)) {
    flags.push('credential_solicitation');
  }

  if (/[A-Za-z0-9+/]{100,}={0,2}/.test(text) && /(?:send|post|fetch|curl|webhook)/i.test(text)) {
    flags.push('encoded_exfiltration');
  }

  return { safe: flags.length === 0, flags };
}
