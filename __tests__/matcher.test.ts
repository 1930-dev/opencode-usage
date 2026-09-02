import { describe, it, expect } from "bun:test"
import { buildMatcher } from "../packages/core/src/ranking/matcher.ts"

describe("matcher", () => {
  const aa = [
    { id: "claude-sonnet-4-5", slug: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", intelligence_index: 53 },
    { id: "gpt-5", slug: "gpt-5", name: "GPT-5", intelligence_index: 55 },
    { id: "deepseek-v3", slug: "deepseek-v3", name: "DeepSeek V3", intelligence_index: 48 },
  ]

  const modelsDev = {
    "claude-sonnet-4-5-20250929": { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", cost: { input: 3, output: 15 } },
    "gpt-5": { id: "gpt-5", name: "GPT-5", cost: { input: 2.5, output: 10 } },
    "deepseek-v3": { id: "deepseek-v3", name: "DeepSeek V3", cost: { input: 0.14, output: 0.28 } },
    "unknown-model": { id: "unknown-model", name: "Unknown", cost: { input: 1, output: 2 } },
  }

  it("matches by normalized id", () => {
    const match = buildMatcher(aa, modelsDev)
    expect(match(modelsDev["claude-sonnet-4-5-20250929"])).toEqual(aa[0])
    expect(match(modelsDev["gpt-5"])).toEqual(aa[1])
    expect(match(modelsDev["deepseek-v3"])).toEqual(aa[2])
  })

  it("returns undefined for no match", () => {
    const match = buildMatcher(aa, modelsDev)
    expect(match(modelsDev["unknown-model"])).toBeUndefined()
  })

  it("strips vendor prefix and date", () => {
    const match = buildMatcher(aa, modelsDev)
    const md = { id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", cost: { input: 3, output: 15 } }
    expect(match(md)).toEqual(aa[0])
  })
})