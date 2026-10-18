import { readFile } from "node:fs/promises"
import { authPath } from "./config.ts"
import { openDb } from "./db.ts"

export interface AuthEntry {
  type: string
  key?: string
  access?: string
  metadata?: Record<string, unknown>
}

export type AuthStore = Record<string, AuthEntry>

/**
 * OpenCode V1 kept credentials in `auth.json`. V2 imports them into its own
 * database during migration and writes every later credential there instead,
 * so the file is frozen at whatever it held the day of the migration: it keeps
 * the accounts that existed then, and never learns the ones added after.
 *
 * The database is therefore the source of truth whenever it holds any, and the
 * file is the fallback for a V1 install or a V2 one whose database is unreadable.
 * Reading both and merging them would resurrect credentials the operator has
 * since logged out of.
 */
export async function readAuth(): Promise<AuthStore> {
  const fromDb = readCredentials()
  if (Object.keys(fromDb).length > 0) return fromDb
  return readAuthFile()
}

async function readAuthFile(): Promise<AuthStore> {
  try {
    return JSON.parse(await readFile(authPath(), "utf8")) as AuthStore
  } catch (err) {
    throw new Error(`cannot read opencode auth store: ${(err as Error).message}`)
  }
}

interface CredentialRow {
  integration_id: string
  value: string
  active: number | null
  time_updated: number | null
}

interface CredentialValue {
  type?: string
  key?: string
  access?: string
  metadata?: Record<string, unknown>
}

/**
 * A row of the `credential` table as an auth entry. The OAuth value carries a
 * refresh token that V2 renews with and that nothing here consumes, so only the
 * access token is carried over: a provider quota call is made with the access
 * token, and a refresh needs an OAuth flow this package does not have.
 */
function toEntry(row: CredentialRow): AuthEntry | undefined {
  let value: CredentialValue
  try {
    value = JSON.parse(row.value) as CredentialValue
  } catch {
    return undefined
  }
  if (value.type === "oauth") return { type: "oauth", access: value.access, metadata: value.metadata }
  if (typeof value.key === "string") return { type: value.type ?? "api", key: value.key, metadata: value.metadata }
  return undefined
}

/**
 * The credentials V2 keeps in its database, newest per integration.
 *
 * `active` is the column that would settle it and it reads null on every row
 * this package has seen, so the newest row wins instead. That agrees with V2
 * while there is one credential per integration, which is what an account list
 * without labels produces; an operator keeping several keys for one provider
 * gets the most recently updated one rather than the account V2 would activate.
 */
function readCredentials(): AuthStore {
  const store: AuthStore = {}
  // Every failure here means the same thing to the caller: no credentials in the
  // database, so the auth.json fallback answers instead. That covers a V1
  // database with no credential table and an unreadable one alike.
  try {
    const db = openDb()
    try {
      const rows = db
        .query<CredentialRow, []>(
          "SELECT integration_id, value, active, time_updated FROM credential ORDER BY time_updated DESC, rowid DESC",
        )
        .all()
      for (const row of rows) {
        if (store[row.integration_id]) continue
        const entry = toEntry(row)
        if (entry) store[row.integration_id] = entry
      }
    } finally {
      db.close()
    }
  } catch {
    return {}
  }
  return store
}

export function authSecret(entry: AuthEntry): string | undefined {
  return entry.key ?? entry.access
}