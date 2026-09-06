import { describe, it, expect, afterEach } from "bun:test"
import { fetchAA, fetchModelsDev } from "../packages/core/src/ranking/fetch.ts"
import { buildTop, RANKING_ATTRIBUTION } from "../packages/core/src/top.ts"
import { makeSandbox, stubFetch, type FetchStub, type Sandbox } from "./support/fixtures.ts"

const DAY = 86_400_000

const MODELS_DEV = {
  anthropic: {
    models: {
      "claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", cost: { input: 3, output: 15 } },
    },
  },
  openai: {
    models: {
      "gpt-5": { id: "gpt-5", name: "GPT-5", cost: { input: 1.25, output: 10 } },
      // No price: never ranked, because the value score would be meaningless.
      "gpt-free": { id: "gpt-free", name: "GPT Free", cost: { input: 0, output: 0 } },
      "no-cost-at-all": { id: "no-cost-at-all", name: "No Cost" },
    },
  },
}

const AA = [
  { id: "1", slug: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", evaluations: { artificial_analysis_intelligence_index: 60, artificial_analysis_coding_index: 71 } },
  { id: "2", slug: "gpt-5", name: "GPT-5", evaluations: { artificial_analysis_intelligence_index: 68, artificial_analysis_coding_index: null } },
]

let sandbox: Sandbox | undefined
let stub: FetchStub | undefined
let previousKey: string | undefined

function setKey(value: string | undefined): void {
  previousKey = process.env.AA_API_KEY
  if (value === undefined) delete process.env.AA_API_KEY
  else process.env.AA_API_KEY = value
}

afterEach(() => {
  if (previousKey === undefined) delete process.env.AA_API_KEY
  else process.env.AA_API_KEY = previousKey
  previousKey = undefined
  stub?.restore()
  stub = undefined
  sandbox?.cleanup()
  sandbox = undefined
})

describe("fetchModelsDev", () => {
  it("flattens every provider into one map and caches it", async () => {
    sandbox = makeSandbox()
    stub = stubFetch(() => ({ body: MODELS_DEV }))
    const models = await fetchModelsDev()
    expect(Object.keys(models).sort()).toEqual(["claude-sonnet-4-5", "gpt-5", "gpt-free", "no-cost-at-all"])
    expect(stub.calls).toHaveLength(1)
    await fetchModelsDev()
    expect(stub.calls).toHaveLength(1)
  })

  it("refetches once the cache is a day old", async () => {
    sandbox = makeSandbox()
    sandbox.writeRankingCache("models-dev.json", Date.now() - DAY - 1, { stale: {} })
    stub = stubFetch(() => ({ body: MODELS_DEV }))
    expect(Object.keys(await fetchModelsDev())).toContain("gpt-5")
    expect(stub.calls).toHaveLength(1)
  })

  it("reports a failed fetch with its status", async () => {
    sandbox = makeSandbox()
    stub = stubFetch(() => ({ status: 502 }))
    await expect(fetchModelsDev()).rejects.toThrow("models.dev fetch failed: HTTP 502")
  })
})

describe("fetchAA", () => {
  it("returns nothing without a key, and never calls the API", async () => {
    sandbox = makeSandbox()
    setKey(undefined)
    stub = stubFetch(() => ({ body: { data: AA } }))
    expect(await fetchAA()).toEqual([])
    expect(stub.calls).toEqual([])
  })

  it("treats an empty key as no key", async () => {
    sandbox = makeSandbox()
    setKey("")
    stub = stubFetch(() => ({ body: { data: AA } }))
    expect(await fetchAA()).toEqual([])
  })

  it("sends the key and caches the answer", async () => {
    sandbox = makeSandbox()
    setKey("aa-test-key")
    stub = stubFetch(() => ({ body: { data: AA } }))
    expect(await fetchAA()).toHaveLength(2)
    expect(stub.calls[0]!.headers["x-api-key"]).toBe("aa-test-key")
    await fetchAA()
    expect(stub.calls).toHaveLength(1)
  })

  it("serves a fresh cache without a key", async () => {
    sandbox = makeSandbox()
    setKey(undefined)
    sandbox.writeRankingCache("aa.json", Date.now(), AA)
    expect(await fetchAA()).toHaveLength(2)
  })

  it("reports a failed fetch with its status", async () => {
    sandbox = makeSandbox()
    setKey("aa-test-key")
    stub = stubFetch(() => ({ status: 429 }))
    await expect(fetchAA()).rejects.toThrow("AA fetch failed: HTTP 429")
  })

  it("ignores a corrupt cache file", async () => {
    sandbox = makeSandbox()
    setKey(undefined)
    await Bun.write(`${sandbox.cachePath}/aa.json`, "{ not json")
    expect(await fetchAA()).toEqual([])
  })
})

describe("buildTop", () => {
  it("ranks priced models by intelligence per blended dollar", async () => {
    sandbox = makeSandbox()
    setKey("aa-test-key")
    stub = stubFetch((url) => ({ body: url.includes("models.dev") ? MODELS_DEV : { data: AA } }))
    const rows = await buildTop(10)
    expect(rows.map((r) => r.model)).toEqual(["gpt-5", "claude-sonnet-4-5"])
    const gpt5 = rows[0]!
    expect(gpt5.name).toBe("GPT-5")
    expect(gpt5.intelligence).toBe(68)
    expect(gpt5.codingIndex).toBeUndefined()
    expect(gpt5.blended).toBeCloseTo(3.4375)
    expect(gpt5.value).toBeCloseTo(68 / 3.4375)
    expect(rows[1]!.codingIndex).toBe(71)
  })

  it("drops a model with no price", async () => {
    sandbox = makeSandbox()
    setKey("aa-test-key")
    stub = stubFetch((url) => ({ body: url.includes("models.dev") ? MODELS_DEV : { data: AA } }))
    const ids = (await buildTop(10)).map((r) => r.model)
    expect(ids).not.toContain("gpt-free")
    expect(ids).not.toContain("no-cost-at-all")
  })

  it("honours the limit", async () => {
    sandbox = makeSandbox()
    setKey("aa-test-key")
    stub = stubFetch((url) => ({ body: url.includes("models.dev") ? MODELS_DEV : { data: AA } }))
    expect(await buildTop(1)).toHaveLength(1)
  })

  it("keeps prices when no key makes the indices unavailable", async () => {
    sandbox = makeSandbox()
    setKey(undefined)
    stub = stubFetch(() => ({ body: MODELS_DEV }))
    const rows = await buildTop(10)
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.intelligence).toBeUndefined()
      expect(r.value).toBeUndefined()
      expect(r.blended).toBeGreaterThan(0)
    }
  })

  it("strips the vendor prefix and keeps one row per model id", async () => {
    sandbox = makeSandbox()
    setKey(undefined)
    stub = stubFetch(() => ({
      body: {
        a: { models: { "vendor/gpt-5": { id: "vendor/gpt-5", name: "GPT-5", cost: { input: 1, output: 2 } } } },
        b: { models: { "other/gpt-5": { id: "other/gpt-5", name: "GPT-5 again", cost: { input: 9, output: 9 } } } },
      },
    }))
    const rows = await buildTop(10)
    expect(rows.map((r) => r.model)).toEqual(["gpt-5"])
  })

  it("names a model by its id when models.dev gives no name", async () => {
    sandbox = makeSandbox()
    setKey(undefined)
    stub = stubFetch(() => ({ body: { a: { models: { nameless: { id: "nameless", cost: { input: 1, output: 1 } } } } } }))
    expect((await buildTop(10))[0]!.name).toBe("nameless")
  })

  it("credits both data sources", () => {
    expect(RANKING_ATTRIBUTION).toContain("Artificial Analysis")
    expect(RANKING_ATTRIBUTION).toContain("models.dev")
  })
})
