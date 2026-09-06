import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { localUsageByProvider, openDb, usageSince, usageTotals } from "../packages/core/src/db.ts"
import { makeSandbox, type MessageSeed, type Sandbox } from "./support/fixtures.ts"
import type { Database } from "bun:sqlite"

const DAY = 86_400_000
/** A fixed clock: the seeds sit at known offsets from it, so no test is dated. */
const NOW = Date.parse("2026-09-06T12:00:00Z")

const SEEDS: MessageSeed[] = [
  { provider: "openrouter", model: "gpt-5", agent: "build", cwd: "/repo/a", cost: 1.5, input: 1000, output: 100, reasoning: 10, cacheRead: 5, cacheWrite: 2, createdMs: NOW - 1 * DAY },
  { provider: "openrouter", model: "gpt-5", agent: "plan", cwd: "/repo/b", cost: 0.5, input: 200, output: 20, createdMs: NOW - 2 * DAY },
  { provider: "groq", model: "llama", agent: "build", cwd: "/repo/a", cost: 0.25, input: 50, output: 5, createdMs: NOW - 1 * DAY },
  // Outside every window the tests ask for.
  { provider: "cerebras", model: "qwen", agent: "build", cwd: "/repo/c", cost: 99, input: 1, output: 1, createdMs: NOW - 40 * DAY },
  // A user message: never counted, whatever the window.
  { provider: "openrouter", model: "gpt-5", role: "user", cost: 1000, input: 7, output: 7, createdMs: NOW - 1 * DAY },
]

describe("db", () => {
  let sandbox: Sandbox
  let db: Database

  beforeEach(() => {
    sandbox = makeSandbox(SEEDS)
    db = openDb()
  })

  afterEach(() => {
    db.close()
    sandbox.cleanup()
  })

  it("opens read-only", () => {
    expect(() => db.exec("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('x','s',1,1,'{}')")).toThrow()
  })

  it("groups by provider, ordered by cost", () => {
    const rows = usageSince(db, NOW - 7 * DAY, "provider")
    expect(rows.map((r) => r.group)).toEqual(["openrouter", "groq"])
    const openrouter = rows[0]!
    expect(openrouter.messages).toBe(2)
    expect(openrouter.cost).toBeCloseTo(2)
    expect(openrouter.tokensInput).toBe(1200)
    expect(openrouter.tokensOutput).toBe(120)
    expect(openrouter.tokensReasoning).toBe(10)
    expect(openrouter.tokensCacheRead).toBe(5)
    expect(openrouter.tokensCacheWrite).toBe(2)
  })

  it("groups by model as provider/model", () => {
    const rows = usageSince(db, NOW - 7 * DAY, "model")
    expect(rows.map((r) => r.group).sort()).toEqual(["groq/llama", "openrouter/gpt-5"])
  })

  it("groups by day as an ISO date", () => {
    const rows = usageSince(db, NOW - 7 * DAY, "day")
    for (const r of rows) expect(r.group).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rows.map((r) => r.group).sort()).toEqual(["2026-09-04", "2026-09-05"])
  })

  it("groups by project", () => {
    const rows = usageSince(db, NOW - 7 * DAY, "project")
    expect(rows.map((r) => r.group).sort()).toEqual(["/repo/a", "/repo/b"])
  })

  it("groups by agent", () => {
    const rows = usageSince(db, NOW - 7 * DAY, "agent")
    expect(rows.map((r) => r.group).sort()).toEqual(["build", "plan"])
  })

  it("defaults the grouping to provider", () => {
    expect(usageSince(db, NOW - 7 * DAY)).toEqual(usageSince(db, NOW - 7 * DAY, "provider"))
  })

  it("honours the window", () => {
    expect(usageSince(db, NOW - 7 * DAY, "provider").map((r) => r.group)).not.toContain("cerebras")
    expect(usageSince(db, NOW - 60 * DAY, "provider").map((r) => r.group)).toContain("cerebras")
  })

  it("returns no rows for a window with no traffic", () => {
    expect(usageSince(db, NOW + DAY, "provider")).toEqual([])
  })

  it("totals only assistant messages in the window", () => {
    const totals = usageTotals(db, NOW - 7 * DAY)
    expect(totals.messages).toBe(3)
    expect(totals.cost).toBeCloseTo(2.25)
    expect(totals.tokensInput).toBe(1250)
    expect(totals.tokensOutput).toBe(125)
  })

  it("totals to zero when the window is empty", () => {
    expect(usageTotals(db, NOW + DAY)).toEqual({ messages: 0, cost: 0, tokensInput: 0, tokensOutput: 0 })
  })

  it("summarises local usage per provider with the last use", () => {
    const local = localUsageByProvider(db, NOW - 7 * DAY)
    expect([...local.keys()].sort()).toEqual(["groq", "openrouter"])
    const openrouter = local.get("openrouter")!
    expect(openrouter.messages).toBe(2)
    expect(openrouter.tokens).toBe(1320)
    expect(openrouter.lastUsedMs).toBe(NOW - DAY)
  })

  it("sums the cost per provider, for a budget in USD", () => {
    const local = localUsageByProvider(db, NOW - 7 * DAY)
    expect(local.get("openrouter")!.cost).toBeCloseTo(2)
    expect(local.get("groq")!.cost).toBeCloseTo(0.25)
    expect(local.has("cerebras")).toBe(false)
  })

  it("labels a message with no provider rather than dropping it", () => {
    sandbox.cleanup()
    sandbox = makeSandbox([{ provider: null as unknown as string, cost: 1, createdMs: NOW }])
    db.close()
    db = openDb()
    const rows = usageSince(db, NOW - DAY, "provider")
    expect(rows[0]!.provider).toBe("?")
    expect(rows[0]!.model).toBe("some-model")
  })
})
