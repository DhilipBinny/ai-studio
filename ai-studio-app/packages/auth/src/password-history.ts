import { verifyPassword } from "./password";
import { AUTH_CONFIG } from "./config";

export async function checkPasswordHistory(
  newPassword: string,
  previousHashes: string[],
): Promise<{ reused: boolean; error?: string }> {
  const limit = AUTH_CONFIG.password.historyCount;
  const toCheck = previousHashes.slice(0, limit);

  for (const hash of toCheck) {
    const match = await verifyPassword(hash, newPassword);
    if (match) {
      return {
        reused: true,
        error: `Password was used recently. Choose a password you haven't used in your last ${limit} changes.`,
      };
    }
  }

  return { reused: false };
}
