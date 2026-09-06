import { describe, it, expect, afterEach } from "bun:test"
import { getUsageSnapshot } from "../packages/core/src/snapshot.ts"
import { makeSandbox, stubFetch, type FetchStub, type MessageSeed, type Sandbox } from "./support/fixtures.ts"

const DAY = 86_400_000
const NOW = Date.now()

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
    // groq: 110k tokens against the documented 200k/day, spread over 30 days.
    expect(snapshot.pct!.groq).toMatchObject({ source: "limits", label: "200,000 tokens/day" })
    expect(snapshot.pct!.groq!.pct).toBeCloseTo((110_000 / 6_000_000) * 100)
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
