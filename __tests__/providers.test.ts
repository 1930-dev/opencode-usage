import { describe, it, expect, afterEach } from "bun:test"
import { providerStatuses } from "../packages/core/src/providers.ts"
import { makeSandbox, stubFetch, type FetchStub, type Sandbox } from "./support/fixtures.ts"

const MINUTE = 60_000
const ZEN_BODY = {
  usage: {
    rolling: { status: "ok", percent: 10, resetsAt: "2026-09-06T17:00:00Z" },
    weekly: { status: "ok", percent: 44, resetsAt: "2026-09-08T00:00:00Z" },
    monthly: { status: "ok", percent: 5, resetsAt: "2026-10-01T00:00:00Z" },
  },
}

let sandbox: Sandbox | undefined
let stub: FetchStub | undefined

afterEach(() => {
  stub?.restore()
  stub = undefined
  sandbox?.cleanup()
  sandbox = undefined
})

describe("providerStatuses", () => {
  it("lists every connected provider in name order", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "g" }, cerebras: { type: "api", key: "c" } })
    stub = stubFetch(() => ({ body: {} }))
    const statuses = await providerStatuses({ noNet: false })
    expect(statuses.map((s) => s.provider)).toEqual(["cerebras", "groq"])
    expect(statuses.every((s) => s.auth)).toBe(true)
  })

  it("fetches live quota and writes it to the cache", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ "opencode-go": { type: "oauth", access: "tok" } })
    stub = stubFetch(() => ({ body: ZEN_BODY }))
    const statuses = await providerStatuses({ noNet: false })
    expect(statuses[0]).toMatchObject({ provider: "opencode-go", quotaSource: "live" })
    expect(statuses[0]!.quota!.budget).toEqual({ percentUsed: 44, label: "weekly" })
    expect(sandbox.readQuotaCache().quotas["opencode-go"]).toBeDefined()
  })

  it("does not touch the network with --no-net, and serves the cache", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ "opencode-go": { type: "oauth", access: "tok" } })
    sandbox.writeQuotaCache(Date.now(), {
      "opencode-go": { provider: "opencode-go", ok: true, windows: [], budget: { percentUsed: 12, label: "weekly" } },
    })
    stub = stubFetch(() => ({ body: ZEN_BODY }))
    const statuses = await providerStatuses({ noNet: true })
    expect(stub.calls).toEqual([])
    expect(statuses[0]!.quotaSource).toBe("cache")
    expect(statuses[0]!.quota!.budget!.percentUsed).toBe(12)
  })

  it("ignores a cache older than its 15 minute life", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ "opencode-go": { type: "oauth", access: "tok" } })
    sandbox.writeQuotaCache(Date.now() - 16 * MINUTE, {
      "opencode-go": { provider: "opencode-go", ok: true, windows: [], budget: { percentUsed: 12, label: "weekly" } },
    })
    const statuses = await providerStatuses({ noNet: true })
    expect(statuses[0]!.quota).toBeNull()
    expect(statuses[0]!.quotaSource).toBe("none")
  })

  it("reports no quota with --no-net and no cache at all", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    const statuses = await providerStatuses({ noNet: true })
    expect(statuses[0]).toMatchObject({ provider: "groq", quota: null, quotaSource: "none" })
  })

  it("falls back to the cache when every live fetch comes back empty", async () => {
    sandbox = makeSandbox()
    // groq has no fetcher, so a live pass produces nothing to cache.
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    sandbox.writeQuotaCache(Date.now(), {
      groq: { provider: "groq", ok: true, windows: [], budget: { percentUsed: 7, label: "day" } },
    })
    const statuses = await providerStatuses({ noNet: false })
    expect(statuses[0]!.quotaSource).toBe("cache")
    expect(statuses[0]!.quota!.budget!.percentUsed).toBe(7)
  })

  it("skips a provider whose entry carries no secret", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ "opencode-go": { type: "wellknown" } })
    stub = stubFetch(() => ({ body: ZEN_BODY }))
    const statuses = await providerStatuses({ noNet: false })
    expect(stub.calls).toEqual([])
    expect(statuses[0]!.quota).toBeNull()
  })

  it("keeps a provider whose quota endpoint failed, marked not ok", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ "opencode-go": { type: "oauth", access: "tok" } })
    stub = stubFetch(() => ({ status: 500 }))
    const statuses = await providerStatuses({ noNet: false })
    expect(statuses[0]!.quota!.ok).toBe(false)
    expect(statuses[0]!.quotaSource).toBe("live")
  })

  it("ignores a corrupt cache file rather than failing the command", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    await Bun.write(`${sandbox.cachePath}/quota.json`, "{ not json")
    const statuses = await providerStatuses({ noNet: true })
    expect(statuses[0]!.quotaSource).toBe("none")
  })

  it("reports a missing auth store as an error", async () => {
    sandbox = makeSandbox()
    await expect(providerStatuses({ noNet: true })).rejects.toThrow("cannot read opencode auth store")
  })
})
