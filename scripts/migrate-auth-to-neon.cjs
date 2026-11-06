const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { neon } = require("@neondatabase/serverless");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL to the Neon Postgres connection string first.");
  const localPath = resolve(process.env.AUTH_DB_PATH || "web/data/auth.sqlite");
  if (!existsSync(localPath)) throw new Error(`Local auth database not found at ${localPath}`);

  const local = new DatabaseSync(localPath, { readOnly: true });
  const users = local.prepare("SELECT id,name,email,password_hash,wallet_address,wallet_nonce,wallet_nonce_expires,created_at FROM users").all();
  const sessions = local.prepare("SELECT token_hash,user_id,expires_at,created_at FROM sessions WHERE expires_at > ?").all(Math.floor(Date.now() / 1000));
  local.close();

  const sql = neon(databaseUrl);
  await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, wallet_address TEXT UNIQUE, wallet_nonce TEXT,
    wallet_nonce_expires BIGINT, created_at BIGINT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)`;

  for (const user of users) {
    await sql`INSERT INTO users (id,name,email,password_hash,wallet_address,wallet_nonce,wallet_nonce_expires,created_at)
      VALUES (${user.id},${user.name},${user.email},${user.password_hash},${user.wallet_address},${user.wallet_nonce},${user.wallet_nonce_expires},${user.created_at})
      ON CONFLICT (id) DO NOTHING`;
  }
  for (const session of sessions) {
    await sql`INSERT INTO sessions (token_hash,user_id,expires_at,created_at)
      VALUES (${session.token_hash},${session.user_id},${session.expires_at},${session.created_at})
      ON CONFLICT (token_hash) DO NOTHING`;
  }
  console.log(`Migrated ${users.length} users and ${sessions.length} active sessions to Neon.`);
  console.log("The local SQLite database was left unchanged.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
