import { describe, it, expect } from "bun:test"
import { parseDuration, startOfDayMs, startOfMonthMs } from "../packages/core/src/types.ts"

describe("parseDuration", () => {
  it("parses hours, days and weeks", () => {
    expect(parseDuration("24h")).toBe(86_400_000)
    expect(parseDuration("7d")).toBe(604_800_000)
    expect(parseDuration("2w")).toBe(1_209_600_000)
  })

  it("tolerates spacing and case", () => {
    expect(parseDuration("  7 D ")).toBe(604_800_000)
  })

  it("rejects a unit it does not know, and anything that is not a duration", () => {
    expect(() => parseDuration("banana")).toThrow("invalid duration")
    expect(() => parseDuration("5x")).toThrow("use Nh, Nd or Nw")
    expect(() => parseDuration("")).toThrow("invalid duration")
    expect(() => parseDuration("7")).toThrow("invalid duration")
  })
})

describe("startOfDayMs", () => {
  it("returns local midnight of the given day", () => {
    const start = new Date(startOfDayMs(new Date("2026-09-01T15:44:00").getTime()))
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getDate()).toBe(1)
  })

  it("defaults to now", () => {
    expect(new Date(startOfDayMs()).getHours()).toBe(0)
  })
})

describe("startOfMonthMs", () => {
  it("returns local midnight of the first of the month", () => {
    const start = new Date(startOfMonthMs(new Date("2026-09-15T15:44:00").getTime()))
    expect(start.getDate()).toBe(1)
    expect(start.getHours()).toBe(0)
    expect(start.getMonth()).toBe(8)
  })

  it("defaults to now", () => {
    expect(new Date(startOfMonthMs()).getDate()).toBe(1)
  })
})
