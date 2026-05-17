import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const globalForDb = globalThis as unknown as {
  _db: ReturnType<typeof drizzle> | undefined;
  _sql: ReturnType<typeof postgres> | undefined;
};

export function getConnectionString(): string {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is required in production");
    }
    return "postgres://aistudio:aistudio_dev_2026@localhost:5480/aistudio";
  }
  return process.env.DATABASE_URL;
}

export function getDb() {
  if (!globalForDb._db) {
    globalForDb._sql = postgres(getConnectionString(), { max: 10 });
    globalForDb._db = drizzle(globalForDb._sql, { schema });
  }
  return globalForDb._db;
}

export function getSql() {
  if (!globalForDb._sql) {
    globalForDb._sql = postgres(getConnectionString(), { max: 10 });
  }
  return globalForDb._sql;
}

export async function closeDb(): Promise<void> {
  if (globalForDb._sql) {
    await globalForDb._sql.end();
    globalForDb._sql = undefined;
    globalForDb._db = undefined;
  }
}

export type Database = ReturnType<typeof getDb>;
