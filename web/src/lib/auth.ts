import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "recircle_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export type User = { id: string; name: string; email: string; walletAddress: string | null };
type UserRow = { id: string; name: string; email: string; password_hash: string; wallet_address: string | null };
type Sql = ReturnType<typeof neon>;
type AuthGlobal = typeof globalThis & { recircleDb?: DatabaseSync; recircleSql?: Sql; recircleSchemaReady?: Promise<void> };

function localDatabase() {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be configured in production; local SQLite is only for development.");
  }
  const global = globalThis as AuthGlobal;
  if (global.recircleDb) return global.recircleDb;
  const appDir = existsSync(join(process.cwd(), "src", "app")) ? process.cwd() : join(process.cwd(), "web");
  const directory = join(appDir, "data");
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(process.env.AUTH_DB_PATH || join(directory, "auth.sqlite"));
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, wallet_address TEXT UNIQUE, wallet_nonce TEXT, wallet_nonce_expires INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);`);
  global.recircleDb = db;
  return db;
}

async function postgres(): Promise<Sql> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to use the hosted auth database.");
  const global = globalThis as AuthGlobal;
  if (!global.recircleSql) global.recircleSql = neon(process.env.DATABASE_URL);
  if (!global.recircleSchemaReady) {
    const sql = global.recircleSql;
    global.recircleSchemaReady = (async () => {
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
    })();
  }
  await global.recircleSchemaReady;
  return global.recircleSql;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const userFromRow = (row: UserRow): User => ({ id: row.id, name: row.name, email: row.email, walletAddress: row.wallet_address });

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt.toString("hex")}.${derived.toString("hex")}`;
}

async function passwordMatches(password: string, encoded: string) {
  const [saltHex, hashHex] = encoded.split(".");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function registerUser(name: string, email: string, password: string) {
  const id = randomBytes(16).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const normalizedEmail = email.toLowerCase();
  const passwordHash = await hashPassword(password);
  try {
    if (process.env.DATABASE_URL) {
      const sql = await postgres();
      const rows = (await sql`INSERT INTO users (id,name,email,password_hash,created_at)
        VALUES (${id},${name},${normalizedEmail},${passwordHash},${now}) RETURNING id,name,email,wallet_address`) as unknown as UserRow[];
      return userFromRow(rows[0] as UserRow);
    }
    localDatabase().prepare("INSERT INTO users (id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)")
      .run(id, name, normalizedEmail, passwordHash, now);
  } catch (error) {
    if ((error as { code?: string }).code === "23505" || (error instanceof Error && error.message.includes("UNIQUE constraint failed"))) {
      throw new Error("An account with that email already exists.");
    }
    throw error;
  }
  return { id, name, email: normalizedEmail, walletAddress: null } satisfies User;
}

export async function authenticateUser(email: string, password: string): Promise<User | null> {
  let row: UserRow | undefined;
  if (process.env.DATABASE_URL) {
    const sql = await postgres();
    const rows = (await sql`SELECT id,name,email,password_hash,wallet_address FROM users WHERE email=${email.trim().toLowerCase()} LIMIT 1`) as unknown as UserRow[];
    row = rows[0] as UserRow | undefined;
  } else {
    row = localDatabase().prepare("SELECT id,name,email,password_hash,wallet_address FROM users WHERE email = ? COLLATE NOCASE")
      .get(email.trim()) as UserRow | undefined;
  }
  if (!row || !(await passwordMatches(password, row.password_hash))) return null;
  return userFromRow(row);
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const expires = now + SESSION_SECONDS;
  if (process.env.DATABASE_URL) {
    const sql = await postgres();
    await sql`DELETE FROM sessions WHERE expires_at <= ${now}`;
    await sql`INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (${tokenHash(token)},${userId},${expires},${now})`;
  } else {
    const db = localDatabase();
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
      .run(tokenHash(token), userId, expires, now);
  }
  cookies().set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS });
}

export async function getCurrentUser(): Promise<User | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const hash = tokenHash(token);
  const now = Math.floor(Date.now() / 1000);
  if (process.env.DATABASE_URL) {
    const sql = await postgres();
    const rows = (await sql`SELECT u.id,u.name,u.email,u.password_hash,u.wallet_address FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=${hash} AND s.expires_at>${now} LIMIT 1`) as unknown as UserRow[];
    return rows[0] ? userFromRow(rows[0] as UserRow) : null;
  }
  const row = localDatabase().prepare(`SELECT u.id,u.name,u.email,u.password_hash,u.wallet_address FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash, now) as UserRow | undefined;
  return row ? userFromRow(row) : null;
}

function requestToken(request: Request) {
  const value = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value ? decodeURIComponent(value) : null;
}

export async function getUserForRequest(request: Request): Promise<User | null> {
  const token = requestToken(request);
  if (!token) return null;
  const hash = tokenHash(token);
  const now = Math.floor(Date.now() / 1000);
  if (process.env.DATABASE_URL) {
    const sql = await postgres();
    const rows = (await sql`SELECT u.id,u.name,u.email,u.password_hash,u.wallet_address FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=${hash} AND s.expires_at>${now} LIMIT 1`) as unknown as UserRow[];
    return rows[0] ? userFromRow(rows[0] as UserRow) : null;
  }
  const row = localDatabase().prepare(`SELECT u.id,u.name,u.email,u.password_hash,u.wallet_address FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash, now) as UserRow | undefined;
  return row ? userFromRow(row) : null;
}

export async function endSession(request?: Request) {
  const token = request ? requestToken(request) : cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    if (process.env.DATABASE_URL) {
      const sql = await postgres();
      await sql`DELETE FROM sessions WHERE token_hash=${tokenHash(token)}`;
    } else localDatabase().prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
  }
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function issueWalletNonce(userId: string) {
  const nonce = randomBytes(24).toString("hex");
  const expires = Math.floor(Date.now() / 1000) + 5 * 60;
  if (process.env.DATABASE_URL) {
    const sql = await postgres();
    await sql`UPDATE users SET wallet_nonce=${nonce},wallet_nonce_expires=${expires} WHERE id=${userId}`;
  } else localDatabase().prepare("UPDATE users SET wallet_nonce=?,wallet_nonce_expires=? WHERE id=?").run(nonce, expires, userId);
  return { nonce, expires };
}

export async function consumeWalletNonce(userId: string, nonce: string) {
  const now = Math.floor(Date.now() / 1000);
  if (process.env.DATABASE_URL) {
    const sql = await postgres();
    const rows = (await sql`UPDATE users SET wallet_nonce=NULL,wallet_nonce_expires=NULL
      WHERE id=${userId} AND wallet_nonce=${nonce} AND wallet_nonce_expires >= ${now} RETURNING id`) as unknown as { id: string }[];
    return rows.length === 1;
  }
  const db = localDatabase();
  const row = db.prepare("SELECT wallet_nonce,wallet_nonce_expires FROM users WHERE id=?").get(userId) as { wallet_nonce: string | null; wallet_nonce_expires: number | null } | undefined;
  if (!row?.wallet_nonce || row.wallet_nonce !== nonce || !row.wallet_nonce_expires || row.wallet_nonce_expires < now) return false;
  db.prepare("UPDATE users SET wallet_nonce=NULL,wallet_nonce_expires=NULL WHERE id=?").run(userId);
  return true;
}

export async function linkWallet(userId: string, address: string) {
  try {
    if (process.env.DATABASE_URL) {
      const sql = await postgres();
      await sql`UPDATE users SET wallet_address=${address} WHERE id=${userId}`;
    } else localDatabase().prepare("UPDATE users SET wallet_address=? WHERE id=?").run(address, userId);
  } catch (error) {
    if ((error as { code?: string }).code === "23505" || (error instanceof Error && error.message.includes("UNIQUE constraint failed"))) {
      throw new Error("That wallet is already linked to another account.");
    }
    throw error;
  }
}
