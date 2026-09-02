import { describe, it, expect } from "bun:test"
import { parseDuration, startOfDayMs, startOfMonthMs } from "../src/types.ts"
import { fmtTokens, fmtCost, fmtAgo } from "../src/report.ts"
import { parseZai } from "../src/quota/zai.ts"
import { resolvePct } from "../src/budget.ts"

describe("parseDuration", () => {
  it("parses h/d/w", () => {
    expect(parseDuration("24h")).toBe(86_400_000)
    expect(parseDuration("7d")).toBe(604_800_000)
    expect(parseDuration("2w")).toBe(1_209_600_000)
  })
  it("rejects invalid", () => {
    expect(() => parseDuration("banana")).toThrow()
    expect(() => parseDuration("5x")).toThrow()
  })
})

describe("startOfDayMs", () => {
  it("returns midnight", () => {
    const now = new Date("2026-09-01T15:44:00")
    const start = startOfDayMs(now.getTime())
    expect(new Date(start).getHours()).toBe(0)
    expect(new Date(start).getDate()).toBe(1)
  })
})

describe("startOfMonthMs", () => {
  it("returns first day midnight", () => {
    const now = new Date("2026-09-15T15:44:00")
    const start = startOfMonthMs(now.getTime())
    const d = new Date(start)
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(0)
    expect(d.getMonth()).toBe(8) // September
  })
})

describe("formatters", () => {
  it("fmtTokens", () => {
    expect(fmtTokens(500)).toBe("500")
    expect(fmtTokens(2500)).toBe("2.5K")
    expect(fmtTokens(5_272_901)).toBe("5.3M")
    expect(fmtTokens(1_200_000_000)).toBe("1.2B")
  })
  it("fmtCost", () => {
    expect(fmtCost(115.215)).toBe("$115.22")
    expect(fmtCost(0)).toBe("$0.00")
  })
  it("fmtAgo", () => {
    const now = Date.parse("2026-09-01T20:00:00Z")
    expect(fmtAgo(now - 30 * 60_000, now)).toBe("30m ago")
    expect(fmtAgo(now - 5 * 3_600_000, now)).toBe("5h ago")
    expect(fmtAgo(now - 3 * 86_400_000, now)).toBe("3d ago")
  })
})

describe("parseZai", () => {
  it("maps no-plan error", () => {
    const r = parseZai({ code: 500, msg: "no coding plan", success: false })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain("coding plan")
  })
  it("maps limits", () => {
    const r = parseZai({
      success: true,
      data: {
        planName: "max",
        limits: [{ name: "tokens", limitType: "TOKENS_LIMIT", percentage: 42, nextResetTime: 1790000000000 }],
      },
    })
    expect(r.ok).toBe(true)
    expect(r.windows[0]!.percentUsed).toBe(42)
    expect(r.windows[0]!.resetsAt).toBeDefined()
  })
})

describe("resolvePct", () => {
  const emptyLimits = new Map<string, any>()

  it("returns live budget when available", () => {
    const live = new Map([["opencode-go", { budget: { percentUsed: 62, label: "5h" }, ok: true, windows: [], provider: "opencode-go", detail: undefined, raw: undefined }]])
    const r = resolvePct("opencode-go", new Map([["opencode-go", { budget: { percentUsed: 62, label: "5h" }, ok: true, windows: [], provider: "opencode-go", detail: undefined, raw: undefined }]]), {}, 0, 0, 0, new Map())
    expect(r.pct).toBe(62)
    expect(r.source).toBe("live")
    expect(r.label).toBe("5h")
  })
  it("falls back to budgets.json", () => {
    const r = resolvePct("digitalocean", new Map(), { digitalocean: 5 }, 2.5, 0, 0, new Map())
    expect(r.pct).toBe(50)
    expect(r.source).toBe("budgets")
  })
  it("returns none when no source", () => {
    const r = resolvePct("unknown", new Map(), {}, 0, 0, 0, new Map())
    expect(r.source).toBe("none")
  })
  it("prefers live over budgets", () => {
    const r = resolvePct("opencode-go", new Map([["opencode-go", { budget: { percentUsed: 80, label: "5h" }, ok: true, windows: [], provider: "opencode-go", detail: undefined, raw: undefined }]]), { "opencode-go": 10 }, 5, 0, 0, new Map())
    expect(r.pct).toBe(80)
    expect(r.source).toBe("live")
  })
})
