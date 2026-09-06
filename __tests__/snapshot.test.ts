import { describe, it, expect, afterEach } from "bun:test"
import { getUsageSnapshot } from "../packages/core/src/snapshot.ts"
import { startOfMonthMs } from "../packages/core/src/types.ts"
import { makeSandbox, stubFetch, type FetchStub, type MessageSeed, type Sandbox } from "./support/fixtures.ts"

const DAY = 86_400_000
const NOW = Date.now()
const startOfMonth = () => startOfMonthMs(NOW)

const SEEDS: MessageSeed[] = [
  { provider: "openrouter", cost: 2, input: 100, output: 10, createdMs: NOW - DAY },
  { provider: "groq", cost: 1, input: 60_000, output: 6_000, createdMs: NOW - DAY },
  { provider: "groq", cost: 0, input: 40_000, output: 4_000, createdMs: NOW - DAY },
]

let sandbox: Sandbox | undefined
let stub: FetchStub | undefined

afterEach(() => {
  stub?.restore()
  stub = undefined
  sandbox?.cleanup()
  sandbox = undefined
})

describe("getUsageSnapshot", () => {
  it("adds every connected provider, idle ones last and alphabetical", async () => {
    sandbox = makeSandbox(SEEDS)
    sandbox.writeAuth({ zai: { type: "api", key: "z" }, cerebras: { type: "api", key: "c" }, groq: { type: "api", key: "g" } })
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "provider", false)
    expect(snapshot.rows.map((r) => r.provider)).toEqual(["openrouter", "groq", "cerebras", "zai"])
    expect(snapshot.rows.find((r) => r.provider === "cerebras")).toMatchObject({ messages: 0, cost: 0 })
    expect(snapshot.totals.messages).toBe(3)
    expect(snapshot.pct).toBeUndefined()
  })

  it("breaks a cost tie on traffic before the name", async () => {
    sandbox = makeSandbox([
      { provider: "bbb", cost: 0, createdMs: NOW - DAY },
      { provider: "aaa", cost: 0, createdMs: NOW - DAY },
      { provider: "aaa", cost: 0, createdMs: NOW - DAY },
    ])
    sandbox.writeAuth({ aaa: { type: "api", key: "a" }, bbb: { type: "api", key: "b" } })
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "provider", false)
    expect(snapshot.rows.map((r) => r.provider)).toEqual(["aaa", "bbb"])
  })

  it("shows only what has traffic when the auth store cannot be read", async () => {
    sandbox = makeSandbox(SEEDS)
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "provider", false)
    expect(snapshot.rows.map((r) => r.provider)).toEqual(["openrouter", "groq"])
  })

  it("leaves a non-provider grouping alone", async () => {
    sandbox = makeSandbox(SEEDS)
    sandbox.writeAuth({ zai: { type: "api", key: "z" } })
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "model", false)
    expect(snapshot.rows.map((r) => r.provider)).not.toContain("zai")
  })

  it("resolves a percentage per provider from live quota, budgets and limits", async () => {
    sandbox = makeSandbox(SEEDS)
    sandbox.writeAuth({ "opencode-go": { type: "oauth", access: "t" }, groq: { type: "api", key: "g" }, openrouter: { type: "api", key: "o" } })
    sandbox.writeBudgets({ openrouter: 4 })
    stub = stubFetch((url) =>
      url.includes("zen")
        ? { body: { usage: { rolling: { status: "ok", percent: 3, resetsAt: "" }, weekly: { status: "ok", percent: 61, resetsAt: "" }, monthly: { status: "ok", percent: 9, resetsAt: "" } } } }
        : { status: 500 },
    )
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "provider", true)
    expect(snapshot.pct!["opencode-go"]).toEqual({ pct: 61, source: "live", label: "weekly" })
    expect(snapshot.pct!.openrouter).toMatchObject({ source: "budgets" })
    expect(snapshot.pct!.groq).toMatchObject({ source: "limits", label: "200,000 tokens/day" })
  })

  it("reads a daily limit against today, whatever window the table shows", async () => {
    sandbox = makeSandbox([
      // Yesterday sizes the table; only today counts against a daily limit.
      { provider: "groq", input: 900_000, output: 100_000, createdMs: NOW - DAY },
      { provider: "groq", input: 18_000, output: 2_000, createdMs: NOW - 60_000 },
    ])
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    stub = stubFetch(() => ({ status: 500 }))
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "provider", true)
    expect(snapshot.rows[0]!.tokensInput + snapshot.rows[0]!.tokensOutput).toBe(1_020_000)
    // 20k of today's tokens against 200k/day, and not a token of yesterday's.
    expect(snapshot.pct!.groq!.pct).toBeCloseTo(10)
  })

  it("reads a monthly budget in USD against the calendar month", async () => {
    sandbox = makeSandbox([
      { provider: "openrouter", cost: 1, createdMs: NOW - 60_000 },
      { provider: "openrouter", cost: 40, createdMs: startOfMonth() - DAY },
    ])
    sandbox.writeAuth({ openrouter: { type: "api", key: "o" } })
    sandbox.writeBudgets({ openrouter: 4 })
    stub = stubFetch(() => ({ status: 500 }))
    const snapshot = await getUsageSnapshot(NOW - 90 * DAY, "provider", true)
    // Last month's $40 sizes the table and never the budget.
    expect(snapshot.rows[0]!.cost).toBeCloseTo(41)
    expect(snapshot.pct!.openrouter!.pct).toBeCloseTo(25)
  })

  it("reports no percentage for a provider metered in credits or neurons", async () => {
    sandbox = makeSandbox([
      { provider: "nvidia", input: 9_000_000, output: 1_000_000, createdMs: NOW - 60_000 },
      { provider: "cloudflare-workers-ai", input: 5_000_000, output: 500_000, createdMs: NOW - 60_000 },
    ])
    sandbox.writeAuth({ nvidia: { type: "api", key: "n" }, "cloudflare-workers-ai": { type: "api", key: "c" } })
    stub = stubFetch(() => ({ status: 500 }))
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "provider", true)
    expect(snapshot.pct!.nvidia).toBeUndefined()
    expect(snapshot.pct!["cloudflare-workers-ai"]).toBeUndefined()
  })

  it("omits a provider that resolves to no percentage at all", async () => {
    sandbox = makeSandbox(SEEDS)
    sandbox.writeAuth({ openrouter: { type: "api", key: "o" } })
    stub = stubFetch(() => ({ status: 500 }))
    const snapshot = await getUsageSnapshot(NOW - 7 * DAY, "provider", true)
    expect(snapshot.pct).toBeDefined()
    expect(snapshot.pct!.openrouter).toBeUndefined()
  })
})
