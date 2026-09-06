import { describe, it, expect, afterEach } from "bun:test"
import { getJson } from "../packages/core/src/quota/shared.ts"
import { fetchZen } from "../packages/core/src/quota/zen.ts"
import { fetchZai, parseZai } from "../packages/core/src/quota/zai.ts"
import { fetchCopilot } from "../packages/core/src/quota/copilot.ts"
import { fetchOpenRouter } from "../packages/core/src/quota/openrouter.ts"
import { stubFetch, type FetchStub } from "./support/fixtures.ts"

let stub: FetchStub | undefined

afterEach(() => {
  stub?.restore()
  stub = undefined
})

describe("getJson", () => {
  it("returns the parsed body and sends a browser user agent", async () => {
    stub = stubFetch(() => ({ body: { hello: "world" } }))
    expect(await getJson("https://example.test/x", { Authorization: "Bearer t" })).toEqual({ hello: "world" })
    expect(stub.calls[0]!.headers["User-Agent"]).toContain("Mozilla/5.0")
    expect(stub.calls[0]!.headers.Authorization).toBe("Bearer t")
  })

  it("turns a non-2xx into an error naming the status and the url", async () => {
    stub = stubFetch(() => ({ status: 503 }))
    await expect(getJson("https://example.test/x", {})).rejects.toThrow("HTTP 503 from https://example.test/x")
  })
})

describe("zen", () => {
  const usage = (rolling: number, weekly: number, monthly: number) => ({
    usage: {
      rolling: { status: "ok", percent: rolling, resetsAt: "2026-09-06T17:00:00Z" },
      weekly: { status: "ok", percent: weekly, resetsAt: "2026-09-08T00:00:00Z" },
      monthly: { status: "ok", percent: monthly, resetsAt: "2026-10-01T00:00:00Z" },
    },
  })

  it("reports the three windows and takes the binding one as the budget", async () => {
    stub = stubFetch(() => ({ body: usage(10, 80, 30) }))
    const quota = await fetchZen("key")
    expect(quota.ok).toBe(true)
    expect(quota.windows.map((w) => w.label)).toEqual(["5h", "weekly", "monthly"])
    expect(quota.budget).toEqual({ percentUsed: 80, label: "weekly" })
  })

  it("takes the rolling window when it is the highest", async () => {
    stub = stubFetch(() => ({ body: usage(95, 20, 30) }))
    expect((await fetchZen("key")).budget).toEqual({ percentUsed: 95, label: "5h" })
  })

  it("reports a failure instead of throwing", async () => {
    stub = stubFetch(() => ({ throws: new Error("network down") }))
    const quota = await fetchZen("key")
    expect(quota).toMatchObject({ provider: "opencode-go", ok: false, detail: "network down", windows: [] })
  })
})

describe("zai", () => {
  it("fetches and parses the coding plan quota", async () => {
    stub = stubFetch(() => ({
      body: { success: true, data: { planName: "max", limits: [{ name: "tokens", percentage: 42, nextResetTime: 1790000000000 }] } },
    }))
    const quota = await fetchZai("key")
    expect(quota.ok).toBe(true)
    expect(quota.budget).toEqual({ percentUsed: 42, label: "tokens" })
  })

  it("reports a failure instead of throwing", async () => {
    stub = stubFetch(() => ({ throws: new Error("timeout") }))
    expect(await fetchZai("key")).toMatchObject({ provider: "zai", ok: false, detail: "timeout" })
  })

  it("rejects a non-zero response code", () => {
    expect(parseZai({ code: 500, msg: "no coding plan" })).toMatchObject({ ok: false, detail: "no coding plan" })
  })

  it("falls back to a generic reason when the body carries no message", () => {
    expect(parseZai({ success: false }).detail).toBe("quota endpoint error")
  })

  it("names a limit by its type when it has no name, and omits a reset it was not given", () => {
    const quota = parseZai({ success: true, data: { limits: [{ limitType: "TOKENS_LIMIT" }] } })
    expect(quota.budget).toEqual({ percentUsed: 0, label: "TOKENS_LIMIT" })
    expect(quota.windows[0]!.resetsAt).toBeUndefined()
  })

  it("names a limit `limit` when it has neither", () => {
    expect(parseZai({ success: true, data: { limits: [{}] } }).budget!.label).toBe("limit")
  })

  it("reports no budget when the plan has no limits", () => {
    expect(parseZai({ success: true, data: { planName: "lite" } }).budget).toBeUndefined()
  })
})

describe("copilot", () => {
  const user = (snapshots: Record<string, unknown>) => ({
    login: "tester",
    copilot_plan: "business",
    quota_reset_date: "2026-10-01",
    quota_snapshots: snapshots,
  })

  it("reads the premium entitlement as the budget", async () => {
    stub = stubFetch(() => ({
      body: user({
        premium_interactions: { percent_remaining: 58, quota_remaining: 4060, unlimited: false, entitlement: 7000, overage_permitted: false },
        completions: { percent_remaining: 100, quota_remaining: 0, unlimited: true, entitlement: 0, overage_permitted: false },
      }),
    }))
    const quota = await fetchCopilot("token")
    expect(quota.ok).toBe(true)
    expect(quota.detail).toBe("plan business")
    expect(quota.budget!.label).toBe("premium/mo")
    expect(quota.budget!.percentUsed).toBeCloseTo(42)
    expect(quota.windows.find((w) => w.label === "premium interactions")!.percentUsed).toBe(42)
    expect(quota.windows.find((w) => w.label === "completions")).toMatchObject({ percentUsed: 0, detail: "unlimited" })
  })

  it("prefers the `remaining` field when the API sends both", async () => {
    stub = stubFetch(() => ({
      body: user({ premium_interactions: { percent_remaining: 0, quota_remaining: 999, unlimited: false, entitlement: 100, overage_permitted: false, remaining: 25 } }),
    }))
    expect((await fetchCopilot("token")).budget!.percentUsed).toBeCloseTo(75)
  })

  it("falls back to the agent snapshot when there is no premium one", async () => {
    stub = stubFetch(() => ({
      body: user({ agent: { percent_remaining: 20, quota_remaining: 60, unlimited: false, entitlement: 300, overage_permitted: false } }),
    }))
    expect((await fetchCopilot("token")).budget!.percentUsed).toBeCloseTo(80)
  })

  it("reports no budget for an unlimited plan", async () => {
    stub = stubFetch(() => ({
      body: user({ premium_interactions: { percent_remaining: 100, quota_remaining: 0, unlimited: true, entitlement: 0, overage_permitted: false } }),
    }))
    const quota = await fetchCopilot("token")
    expect(quota.ok).toBe(true)
    expect(quota.budget).toBeUndefined()
  })

  it("reports no budget when the entitlement is zero but the plan is not unlimited", async () => {
    stub = stubFetch(() => ({
      body: user({ premium_interactions: { percent_remaining: 100, quota_remaining: 0, unlimited: false, entitlement: 0, overage_permitted: false } }),
    }))
    expect((await fetchCopilot("token")).budget).toBeUndefined()
  })

  it("stays usable when the account reports no snapshots at all", async () => {
    stub = stubFetch(() => ({ body: { login: "tester", copilot_plan: "individual" } }))
    const quota = await fetchCopilot("token")
    expect(quota.ok).toBe(true)
    expect(quota.windows).toEqual([])
    expect(quota.budget).toBeUndefined()
  })

  it("ignores a snapshot it does not know about", async () => {
    stub = stubFetch(() => ({
      body: user({ some_future_quota: { percent_remaining: 50, quota_remaining: 1, unlimited: false, entitlement: 2, overage_permitted: false } }),
    }))
    expect((await fetchCopilot("token")).windows).toEqual([])
  })

  it("reports a failure instead of throwing", async () => {
    stub = stubFetch(() => ({ status: 401 }))
    expect(await fetchCopilot("token")).toMatchObject({ provider: "github-copilot", ok: false })
  })
})

describe("openrouter", () => {
  const credits = (total: number, used: number) => ({ data: { total_credits: total, total_usage: used } })
  const key = { data: { label: "sk", usage: 1, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 2, limit: null } }

  it("reports credits used as the budget and the key windows", async () => {
    stub = stubFetch((url) => ({ body: url.endsWith("/credits") ? credits(100, 25) : key }))
    const quota = await fetchOpenRouter("sk-test")
    expect(quota.ok).toBe(true)
    expect(quota.detail).toBe("balance $75.00 of $100.00")
    expect(quota.budget).toEqual({ percentUsed: 25, label: "credits" })
    expect(quota.windows.map((w) => w.label)).toEqual(["daily", "weekly", "monthly"])
    expect(quota.windows[0]!.detail).toBe("$0.1000")
  })

  it("keeps the credit budget when the key endpoint is unavailable", async () => {
    stub = stubFetch((url) => (url.endsWith("/credits") ? { body: credits(50, 10) } : { status: 403 }))
    const quota = await fetchOpenRouter("sk-test")
    expect(quota.ok).toBe(true)
    expect(quota.windows).toEqual([])
    expect(quota.budget).toEqual({ percentUsed: 20, label: "credits" })
  })

  it("reports no budget for an account that was never funded", async () => {
    stub = stubFetch((url) => ({ body: url.endsWith("/credits") ? credits(0, 0) : key }))
    const quota = await fetchOpenRouter("sk-test")
    expect(quota.budget).toBeUndefined()
    expect(quota.ok).toBe(true)
  })

  it("reports a failure instead of throwing", async () => {
    stub = stubFetch(() => ({ throws: new Error("dns failure") }))
    expect(await fetchOpenRouter("sk-test")).toMatchObject({ provider: "openrouter", ok: false, detail: "dns failure" })
  })
})
