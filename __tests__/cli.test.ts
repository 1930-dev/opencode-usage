import { describe, it, expect } from "bun:test"
import { parseDuration, startOfDayMs } from "../src/types.ts"
import { fmtTokens, fmtCost, fmtAgo } from "../src/report.ts"
import { parseZai } from "../src/quota/zai.ts"

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
