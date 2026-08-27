import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1 });
try {
  const migration = await readFile(
    new URL("../database/migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(742038516)`;
    await transaction.unsafe(`
      CREATE TABLE IF NOT EXISTS canvas_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await transaction`
      SELECT version FROM canvas_schema_migrations WHERE version = '001_initial'
    `;
    if (!applied.length) {
      await transaction.unsafe(migration);
      await transaction`
        INSERT INTO canvas_schema_migrations (version) VALUES ('001_initial')
      `;
    }
    const username = process.env.CANVAS_ADMIN_USERNAME?.trim() || "admin";
    if (process.env.CANVAS_AUTH_DISABLED === "true") {
      const existingAdmin = await transaction`
        SELECT id FROM canvas_users
        WHERE lower(username) = lower(${username})
          AND is_admin = true
          AND disabled_at IS NULL
        LIMIT 1
      `;
      if (!existingAdmin.length) {
        throw new Error(
          `CANVAS_AUTH_DISABLED=true requires an existing active admin user named ${username}`,
        );
      }
    } else {
      const passwordHash = process.env.CANVAS_ADMIN_PASSWORD_HASH?.trim();
      if (!passwordHash) throw new Error("CANVAS_ADMIN_PASSWORD_HASH is required");
      await transaction`
        INSERT INTO canvas_users (id, username, password_hash, is_admin)
        VALUES (${randomUUID()}, ${username}, ${passwordHash}, true)
        ON CONFLICT ((lower(username))) DO NOTHING
      `;
    }
  });
} finally {
  await sql.end();
}
