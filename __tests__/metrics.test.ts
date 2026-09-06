import { describe, it, expect } from "bun:test"
import { blendedPrice, valueScore, formatSuffix, getIntelligenceIndex } from "../packages/core/src/ranking/metrics.ts"

describe("metrics", () => {
  it("blendedPrice 3:1", () => {
    expect(blendedPrice({ input: 3, output: 15 })).toBe(6)
    expect(blendedPrice({ input: 0.5, output: 1.5 })).toBe(0.75)
    expect(blendedPrice({ input: 0, output: 0 })).toBe(0)
  })

  it("valueScore", () => {
    expect(valueScore(60, { input: 3, output: 15 })).toBeCloseTo(10)
    expect(valueScore(50, { input: 1, output: 4 })).toBeCloseTo(50 / 1.75)
    expect(valueScore(undefined, { input: 3, output: 15 })).toBeUndefined()
    expect(valueScore(60, { input: 0, output: 0 })).toBeUndefined()
  })

  it("formatSuffix", () => {
    expect(formatSuffix({ input: 3, output: 15 }, 60)).toBe(" · $6/M · 10.0")
    expect(formatSuffix({ input: 0.5, output: 1.5 }, 50)).toBe(" · $0.75/M · 66.7")
    expect(formatSuffix({ input: 0, output: 0 }, 60)).toBe("")
    expect(formatSuffix(undefined, 60)).toBe("")
    expect(formatSuffix({ input: 2, output: 8 }, undefined)).toBe(" · $4/M")
  })
})
describe("getIntelligenceIndex", () => {
  it("reads the index when the model was evaluated", () => {
    expect(getIntelligenceIndex({ id: "1", name: "M", slug: "m", evaluations: { artificial_analysis_intelligence_index: 61 } })).toBe(61)
  })

  it("returns nothing for a null index or no evaluations at all", () => {
    expect(getIntelligenceIndex({ id: "1", name: "M", slug: "m", evaluations: { artificial_analysis_intelligence_index: null } })).toBeUndefined()
    expect(getIntelligenceIndex({ id: "1", name: "M", slug: "m", evaluations: {} })).toBeUndefined()
    expect(getIntelligenceIndex({ id: "1", name: "M", slug: "m" })).toBeUndefined()
  })
})
