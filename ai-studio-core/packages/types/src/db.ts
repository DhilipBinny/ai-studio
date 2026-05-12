export interface DatabaseAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  transaction<T>(fn: () => T | Promise<T>): Promise<T>;
  pragma(statement: string): unknown;
  close(): void | Promise<void>;
  backup(path: string): void | Promise<void>;
}
