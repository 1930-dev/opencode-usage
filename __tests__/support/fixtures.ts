/**
 * Test scaffolding. Every module in core reads its paths from the environment
 * through config.ts, so a test points those at a temporary directory and gets a
 * real SQLite file, a real auth store and a real cache with no global state.
 */
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/** One assistant message, in the shape opencode writes into `message.data`. */
export interface MessageSeed {
  provider: string
  model?: string
  agent?: string
  cwd?: string
  cost?: number
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  createdMs: number
  role?: string
}

export interface Sandbox {
  dir: string
  dbPath: string
  authPath: string
  cachePath: string
  budgetsPath: string
  /** Writes `auth.json`; every key is a connected provider. */
  writeAuth(store: Record<string, { type: string; key?: string; access?: string }>): void
  writeBudgets(budgets: Record<string, number>): void
  /** Writes the quota cache the way providers.ts expects to read it. */
  writeQuotaCache(fetchedAt: number, quotas: Record<string, unknown>): void
  readQuotaCache(): { fetchedAt: number; quotas: Record<string, unknown> }
  writeRankingCache(file: string, fetchedAt: number, data: unknown): void
  cleanup(): void
}

const SCHEMA = `CREATE TABLE message (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
)`

function messageData(seed: MessageSeed): string {
  return JSON.stringify({
    role: seed.role ?? "assistant",
    providerID: seed.provider,
    modelID: seed.model ?? "some-model",
    agent: seed.agent ?? "build",
    cost: seed.cost ?? 0,
    tokens: {
      input: seed.input ?? 0,
      output: seed.output ?? 0,
      reasoning: seed.reasoning ?? 0,
      cache: { read: seed.cacheRead ?? 0, write: seed.cacheWrite ?? 0 },
    },
    time: { created: seed.createdMs, completed: seed.createdMs },
    path: { cwd: seed.cwd ?? "/tmp/project", root: "/" },
  })
}

/**
 * Creates the sandbox and points opencode's four paths at it. The caller must
 * call `cleanup` — it restores the environment as well as removing the files.
 */
export function makeSandbox(messages: MessageSeed[] = []): Sandbox {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-usage-test-"))
  const dbPath = path.join(dir, "opencode.db")
  const authPath = path.join(dir, "auth.json")
  const cachePath = path.join(dir, "cache")
  const budgetsPath = path.join(dir, "budgets.json")

  const db = new Database(dbPath)
  db.exec(SCHEMA)
  const insert = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
  messages.forEach((seed, i) => {
    insert.run(`msg-${i}`, "ses-1", seed.createdMs, seed.createdMs, messageData(seed))
  })
  db.close()

  const previous = {
    db: process.env.OPENCODE_DB_PATH,
    auth: process.env.OPENCODE_AUTH_PATH,
    cache: process.env.OPENCODE_USAGE_CACHE,
    budgets: process.env.OPENCODE_USAGE_BUDGETS,
  }
  process.env.OPENCODE_DB_PATH = dbPath
  process.env.OPENCODE_AUTH_PATH = authPath
  process.env.OPENCODE_USAGE_CACHE = cachePath
  process.env.OPENCODE_USAGE_BUDGETS = budgetsPath

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  return {
    dir,
    dbPath,
    authPath,
    cachePath,
    budgetsPath,
    writeAuth(store) {
      writeFileSync(authPath, JSON.stringify(store))
    },
    writeBudgets(budgets) {
      writeFileSync(budgetsPath, JSON.stringify(budgets))
    },
    writeQuotaCache(fetchedAt, quotas) {
      mkdirSync(cachePath, { recursive: true })
      writeFileSync(path.join(cachePath, "quota.json"), JSON.stringify({ fetchedAt, quotas }))
    },
    readQuotaCache() {
      return JSON.parse(readFileSync(path.join(cachePath, "quota.json"), "utf8"))
    },
    writeRankingCache(file, fetchedAt, data) {
      mkdirSync(cachePath, { recursive: true })
      writeFileSync(path.join(cachePath, file), JSON.stringify({ fetchedAt, data }))
    },
    cleanup() {
      restore("OPENCODE_DB_PATH", previous.db)
      restore("OPENCODE_AUTH_PATH", previous.auth)
      restore("OPENCODE_USAGE_CACHE", previous.cache)
      restore("OPENCODE_USAGE_BUDGETS", previous.budgets)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export interface FetchCall {
  url: string
  headers: Record<string, string>
}

export interface FetchStub {
  calls: FetchCall[]
  restore(): void
}

type Responder = (url: string) => { status?: number; body?: unknown; throws?: Error }

/**
 * Replaces global fetch for the duration of a test. `responder` answers by URL;
 * returning `throws` simulates a transport failure, which is a different path
 * from a non-2xx response.
 */
export function stubFetch(responder: Responder): FetchStub {
  const original = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const answer = responder(url)
    if (answer.throws) throw answer.throws
    const status = answer.status ?? 200
    return new Response(JSON.stringify(answer.body ?? {}), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

/** Collects console.log output so a test can assert on what a command printed. */
export function captureLog(): { lines: string[]; restore(): void } {
  const original = console.log
  const lines: string[] = []
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "))
  }
  return {
    lines,
    restore() {
      console.log = original
    },
  }
}
