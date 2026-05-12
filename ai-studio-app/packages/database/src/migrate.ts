import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getConnectionString } from "./connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = postgres(getConnectionString());

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files`);

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  for (const file of files) {
    const version = parseInt(file.split("_")[0], 10);

    const applied = await sql`
      SELECT version FROM schema_migrations WHERE version = ${version}
    `;

    if (applied.length > 0) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }

    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`  → Applying ${file}...`);
    await sql.unsafe(sqlContent);
    console.log(`  ✓ ${file}`);
  }

  await sql.end();
  console.log("Migrations complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
