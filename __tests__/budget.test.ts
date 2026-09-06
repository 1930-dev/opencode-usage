import { describe, it, expect, afterEach } from "bun:test"
import { readBudgets, resolvePct } from "../packages/core/src/budget.ts"
import { getLimit, limitsAsMap, PROVIDER_LIMITS, type ProviderLimit } from "../packages/core/src/limits.ts"
import type { ProviderQuota } from "../packages/core/src/quota/shared.ts"
import { makeSandbox, type Sandbox } from "./support/fixtures.ts"

const NO_LIMITS = new Map<string, ProviderLimit>()

function liveQuota(provider: string, percentUsed: number, label: string, ok = true): Map<string, ProviderQuota> {
  return new Map([[provider, { provider, ok, windows: [], budget: { percentUsed, label } }]])
}

describe("limits", () => {
  it("has one entry per provider, each citing a source", () => {
    const providers = PROVIDER_LIMITS.map((l) => l.provider)
    expect(new Set(providers).size).toBe(providers.length)
    for (const limit of PROVIDER_LIMITS) {
      expect(limit.source.length).toBeGreaterThan(0)
      expect(limit.unit.length).toBeGreaterThan(0)
    }
  })

  it("finds a provider by name, and nothing for one it does not document", () => {
    expect(getLimit("groq")).toMatchObject({ metric: "tokens/day", limit: 200_000 })
    expect(getLimit("anthropic")).toBeUndefined()
  })

  it("indexes every limit by provider", () => {
    const map = limitsAsMap()
    expect(map.size).toBe(PROVIDER_LIMITS.length)
    expect(map.get("cerebras")!.limit).toBe(1_000_000)
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
    const r = resolvePct("opencode-go", liveQuota("opencode-go", 62, "5h"), { "opencode-go": 10 }, 5, 0, 0, limitsAsMap())
    expect(r).toEqual({ pct: 62, source: "live", label: "5h" })
  })

  it("ignores live quota the provider could not answer for", () => {
    const r = resolvePct("groq", liveQuota("groq", 62, "5h", false), { groq: 4 }, 1, 0, 0, NO_LIMITS)
    expect(r.source).toBe("budgets")
    expect(r.pct).toBe(25)
  })

  it("falls back to the monthly budget in budgets.json", () => {
    expect(resolvePct("digitalocean", new Map(), { digitalocean: 5 }, 2.5, 0, 0, NO_LIMITS)).toEqual({ pct: 50, source: "budgets" })
  })

  it("reports zero rather than infinity for a budget of zero", () => {
    expect(resolvePct("groq", new Map(), { groq: 0 }, 9, 0, 0, NO_LIMITS)).toEqual({ pct: 0, source: "budgets" })
  })

  it("spreads a documented daily token limit over the month", () => {
    const r = resolvePct("groq", new Map(), {}, 0, 600_000, 0, limitsAsMap())
    expect(r.source).toBe("limits")
    expect(r.label).toBe("200,000 tokens/day")
    expect(r.pct).toBeCloseTo(10)
  })

  it("uses request count for a provider metered in requests", () => {
    const r = resolvePct("google", new Map(), {}, 0, 999, 4_500, limitsAsMap())
    expect(r.source).toBe("limits")
    expect(r.label).toBe("1,500 requests/day")
    expect(r.pct).toBeCloseTo(10)
  })

  it("reports nothing for a limit measured in credits", () => {
    expect(resolvePct("nvidia", new Map(), {}, 0, 5_000, 10, limitsAsMap()).source).toBe("none")
  })

  it("reports nothing for a limit measured in neurons", () => {
    expect(resolvePct("cloudflare-workers-ai", new Map(), {}, 0, 5_000, 10, limitsAsMap()).source).toBe("none")
  })

  it("reports nothing for a provider whose limit is undocumented", () => {
    expect(resolvePct("orcarouter", new Map(), {}, 0, 5_000, 10, limitsAsMap()).source).toBe("none")
  })

  it("reports nothing for a metric it does not know how to count", () => {
    const limits = new Map<string, ProviderLimit>([
      ["odd", { provider: "odd", metric: "tokens/minute", limit: 30_000, unit: "tokens", tier: "free", source: "test" }],
    ])
    expect(resolvePct("odd", new Map(), {}, 0, 5_000, 10, limits).source).toBe("none")
  })

  it("reports nothing when the provider has no source at all", () => {
    expect(resolvePct("unknown", new Map(), {}, 0, 0, 0, limitsAsMap())).toEqual({ pct: 0, source: "none" })
  })
})
