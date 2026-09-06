import { describe, it, expect, afterEach } from "bun:test"
import { readBudgets, resolvePct, type PctSources } from "../packages/core/src/budget.ts"
import { getLimit, isMeasurable, limitLabel, limitsAsMap, PROVIDER_LIMITS, type ProviderLimit } from "../packages/core/src/limits.ts"
import type { ProviderQuota } from "../packages/core/src/quota/shared.ts"
import { makeSandbox, type Sandbox } from "./support/fixtures.ts"

/** The sources with nothing in them; each test fills in only what it is about. */
function sources(over: Partial<PctSources> = {}): PctSources {
  return {
    live: new Map(),
    budgets: {},
    monthCost: 0,
    usage: { day: { tokens: 0, requests: 0 }, month: { tokens: 0, requests: 0 } },
    limits: limitsAsMap(),
    ...over,
  }
}

function liveQuota(provider: string, percentUsed: number, label: string, ok = true): Map<string, ProviderQuota> {
  return new Map([[provider, { provider, ok, windows: [], budget: { percentUsed, label } }]])
}

describe("limits", () => {
  it("has one entry per provider, each citing a source", () => {
    const providers = PROVIDER_LIMITS.map((l) => l.provider)
    expect(new Set(providers).size).toBe(providers.length)
    for (const limit of PROVIDER_LIMITS) expect(limit.source.length).toBeGreaterThan(0)
  })

  it("lists the providers alphabetically", () => {
    const providers = PROVIDER_LIMITS.map((l) => l.provider)
    expect(providers).toEqual([...providers].sort())
  })

  it("finds a provider by name, and nothing for one it does not document", () => {
    expect(getLimit("groq")).toMatchObject({ unit: "tokens", period: "day", limit: 200_000 })
    expect(getLimit("anthropic")).toBeUndefined()
  })

  it("indexes every limit by provider", () => {
    const map = limitsAsMap()
    expect(map.size).toBe(PROVIDER_LIMITS.length)
    expect(map.get("cerebras")!.limit).toBe(1_000_000)
  })

  it("measures a limit counted in tokens or requests", () => {
    expect(isMeasurable(getLimit("groq")!)).toBe(true)
    expect(isMeasurable(getLimit("google")!)).toBe(true)
  })

  it("does not measure a limit counted in the provider's own unit", () => {
    expect(isMeasurable(getLimit("cloudflare-workers-ai")!)).toBe(false)
    expect(isMeasurable(getLimit("nvidia")!)).toBe(false)
    expect(isMeasurable(getLimit("snowflake-cortex")!)).toBe(false)
  })

  it("does not measure a limit nobody published", () => {
    expect(isMeasurable(getLimit("orcarouter")!)).toBe(false)
  })

  it("writes a limit the way the provider does", () => {
    expect(limitLabel(getLimit("groq")!)).toBe("200,000 tokens/day")
    expect(limitLabel(getLimit("google")!)).toBe("1,500 requests/day")
    expect(limitLabel(getLimit("nvidia")!)).toBe("1,000 credits/month")
  })
})

describe("readBudgets", () => {
  let sandbox: Sandbox | undefined

  afterEach(() => {
    sandbox?.cleanup()
    sandbox = undefined
  })

  it("reads the file when it is there", async () => {
    sandbox = makeSandbox()
    sandbox.writeBudgets({ digitalocean: 5, nvidia: 1 })
    expect(await readBudgets()).toEqual({ digitalocean: 5, nvidia: 1 })
  })

  it("treats a missing file as no budgets, not as an error", async () => {
    sandbox = makeSandbox()
    expect(await readBudgets()).toEqual({})
  })

  it("treats a corrupt file the same way", async () => {
    sandbox = makeSandbox()
    await Bun.write(sandbox.budgetsPath, "{ not json")
    expect(await readBudgets()).toEqual({})
  })
})

describe("resolvePct", () => {
  it("prefers live quota over every other source", () => {
    const r = resolvePct("opencode-go", sources({ live: liveQuota("opencode-go", 62, "5h"), budgets: { "opencode-go": 10 }, monthCost: 5 }))
    expect(r).toEqual({ pct: 62, source: "live", label: "5h" })
  })

  it("ignores live quota the provider could not answer for", () => {
    const r = resolvePct("groq", sources({ live: liveQuota("groq", 62, "5h", false), budgets: { groq: 4 }, monthCost: 1 }))
    expect(r).toEqual({ pct: 25, source: "budgets" })
  })

  it("falls back to the monthly budget in budgets.json", () => {
    expect(resolvePct("digitalocean", sources({ budgets: { digitalocean: 5 }, monthCost: 2.5 }))).toEqual({ pct: 50, source: "budgets" })
  })

  it("reports zero rather than infinity for a budget of zero", () => {
    expect(resolvePct("groq", sources({ budgets: { groq: 0 }, monthCost: 9 }))).toEqual({ pct: 0, source: "budgets" })
  })

  it("reads a daily token limit against today, not against the table's window", () => {
    const r = resolvePct(
      "groq",
      sources({ usage: { day: { tokens: 20_000, requests: 3 }, month: { tokens: 4_000_000, requests: 900 } } }),
    )
    expect(r).toEqual({ pct: 10, source: "limits", label: "200,000 tokens/day" })
  })

  it("reads a daily request limit against today's requests", () => {
    const r = resolvePct(
      "google",
      sources({ usage: { day: { tokens: 9_000_000, requests: 150 }, month: { tokens: 0, requests: 40_000 } } }),
    )
    expect(r).toEqual({ pct: 10, source: "limits", label: "1,500 requests/day" })
  })

  it("reads a monthly limit against the month", () => {
    const limits = new Map<string, ProviderLimit>([
      ["monthly", { provider: "monthly", unit: "tokens", period: "month", limit: 1_000_000, tier: "paid", source: "test" }],
    ])
    const r = resolvePct("monthly", sources({ limits, usage: { day: { tokens: 1_000, requests: 1 }, month: { tokens: 250_000, requests: 30 } } }))
    expect(r).toMatchObject({ pct: 25, source: "limits", label: "1,000,000 tokens/month" })
  })

  it("reports a provider that is over its documented limit", () => {
    const r = resolvePct("groq", sources({ usage: { day: { tokens: 300_000, requests: 0 }, month: { tokens: 0, requests: 0 } } }))
    expect(r.pct).toBeCloseTo(150)
  })

  it("reports nothing for a limit counted in credits or neurons", () => {
    const heavy = { day: { tokens: 5_000_000, requests: 900 }, month: { tokens: 90_000_000, requests: 30_000 } }
    expect(resolvePct("nvidia", sources({ usage: heavy })).source).toBe("none")
    expect(resolvePct("cloudflare-workers-ai", sources({ usage: heavy })).source).toBe("none")
    expect(resolvePct("snowflake-cortex", sources({ usage: heavy })).source).toBe("none")
  })

  it("reports nothing for a provider whose limit is undocumented", () => {
    expect(resolvePct("orcarouter", sources({ usage: { day: { tokens: 5_000, requests: 10 }, month: { tokens: 0, requests: 0 } } })).source).toBe("none")
  })

  it("reports nothing when the provider has no source at all", () => {
    expect(resolvePct("unknown", sources())).toEqual({ pct: 0, source: "none" })
  })
})
