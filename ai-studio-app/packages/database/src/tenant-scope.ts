import { sql } from "drizzle-orm";
import { getDb, type Database } from "./connection";

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
