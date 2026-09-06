import { describe, it, expect } from "bun:test"
import { fmtAgo, fmtCost, fmtTokens, providersTable, usageTable } from "../packages/core/src/report.ts"
import type { UsageRow, UsageTotals } from "../packages/core/src/types.ts"
import type { ProviderStatus } from "../packages/core/src/providers.ts"

function usageRow(provider: string, over: Partial<UsageRow> = {}): UsageRow {
  return {
    group: provider,
    provider,
    model: "",
    day: "",
    project: "",
    agent: "",
    messages: 1,
    cost: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensReasoning: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    ...over,
  }
}

const TOTALS: UsageTotals = { messages: 3, cost: 12.5, tokensInput: 1_500_000, tokensOutput: 2_500 }

describe("formatters", () => {
  it("fmtTokens scales to K, M and B", () => {
    expect(fmtTokens(0)).toBe("0")
    expect(fmtTokens(999)).toBe("999")
    expect(fmtTokens(2_500)).toBe("2.5K")
    expect(fmtTokens(5_272_901)).toBe("5.3M")
    expect(fmtTokens(1_200_000_000)).toBe("1.2B")
  })

  it("fmtCost always shows two decimals", () => {
    expect(fmtCost(0)).toBe("$0.00")
    expect(fmtCost(115.215)).toBe("$115.22")
  })

  it("fmtAgo rounds to minutes, hours and days, and never says 0m", () => {
    const now = Date.parse("2026-09-06T20:00:00Z")
    expect(fmtAgo(now, now)).toBe("1m ago")
    expect(fmtAgo(now - 30 * 60_000, now)).toBe("30m ago")
    expect(fmtAgo(now - 5 * 3_600_000, now)).toBe("5h ago")
    expect(fmtAgo(now - 3 * 86_400_000, now)).toBe("3d ago")
  })
})

describe("usageTable", () => {
  const rows = [usageRow("openrouter", { cost: 12.5, tokensInput: 1_500_000, tokensOutput: 2_500, messages: 2 }), usageRow("groq")]

  it("renders a header, a rule and one line per row", () => {
    const out = usageTable(rows, TOTALS, "7d", "provider")
    const lines = out.split("\n")
    expect(lines[0]).toContain("PROVIDER")
    expect(lines[0]).not.toContain("% BUDGET")
    expect(lines[1]).toMatch(/^-+/)
    expect(lines[2]).toContain("openrouter")
    expect(out).toContain("TOTAL since 7d: 3 msgs, 1.5M in / 2.5K out, $12.50 est.")
  })

  it("adds the budget column and lists the distinct sources", () => {
    const pct = new Map([
      ["openrouter", { pct: 42.25, source: "live", label: "credits" }],
      ["groq", { pct: 3, source: "limits" }],
    ])
    const out = usageTable(rows, TOTALS, "today", "provider", pct)
    expect(out).toContain("% BUDGET")
    expect(out).toContain("42.3% credits")
    expect(out).toContain("3.0%")
    expect(out).toContain("[sources: live(credits), limits]")
  })

  it("marks a provider with no budget source", () => {
    const out = usageTable(rows, TOTALS, "7d", "provider", new Map([["openrouter", { pct: 1, source: "live" }]]))
    expect(out.split("\n").find((l) => l.startsWith("groq"))).toContain("—")
  })

  it("stops at 30 rows", () => {
    const many = Array.from({ length: 40 }, (_, i) => usageRow(`p${i}`))
    const body = usageTable(many, TOTALS, "7d", "provider").split("\n\n")[0]!.split("\n")
    expect(body.length).toBe(32) // header, rule, 30 rows
  })

  it("titles the first column after the grouping", () => {
    expect(usageTable(rows, TOTALS, "7d", "agent").split("\n")[0]).toContain("AGENT")
  })
})

describe("providersTable", () => {
  function status(over: Partial<ProviderStatus>): ProviderStatus {
    return { provider: "groq", auth: true, quota: null, quotaSource: "none", ...over }
  }

  it("renders local usage and the last use", () => {
    const local = new Map([["groq", { messages: 4, cost: 1.5, lastUsedMs: Date.now() - 3_600_000 }]])
    const out = providersTable([status({})], local)
    expect(out).toContain("PROVIDER")
    expect(out).toContain("solo-local")
    expect(out).toContain("4 msgs, $1.50")
    expect(out).toContain("1h ago")
  })

  it("says never for a connected provider with no traffic", () => {
    const out = providersTable([status({})], new Map())
    expect(out).toContain("never")
    expect(out).toContain("—")
  })

  it("prefers a window's detail over its percentage", () => {
    const quota = { provider: "groq", ok: true, windows: [{ label: "daily", percentUsed: 10, detail: "$0.10" }] }
    expect(providersTable([status({ quota })], new Map())).toContain("daily $0.10")
  })

  it("shows a percentage for a window with no detail", () => {
    const quota = { provider: "groq", ok: true, windows: [{ label: "weekly", percentUsed: 44 }] }
    expect(providersTable([status({ quota })], new Map())).toContain("weekly 44%")
  })

  it("falls back to the quota detail when there are no windows", () => {
    const quota = { provider: "groq", ok: true, detail: "plan business", windows: [] }
    expect(providersTable([status({ quota })], new Map())).toContain("plan business")
  })

  it("says ok when a working quota carries neither windows nor detail", () => {
    const quota = { provider: "groq", ok: true, windows: [] }
    expect(providersTable([status({ quota })], new Map())).toContain("ok")
  })

  it("reports why a quota is unavailable", () => {
    const quota = { provider: "groq", ok: false, detail: "HTTP 401", windows: [] }
    expect(providersTable([status({ quota })], new Map())).toContain("unavailable (HTTP 401)")
  })

  it("says error when a failed quota gives no reason", () => {
    const quota = { provider: "groq", ok: false, windows: [] }
    expect(providersTable([status({ quota })], new Map())).toContain("unavailable (error)")
  })
})
