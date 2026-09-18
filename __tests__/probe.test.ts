import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { runProbes } from "../packages/core/src/probe.ts"
import { probeTable, fmtRetry } from "../packages/core/src/report.ts"
import { cmdProbe } from "../packages/cli/src/main.ts"
import { captureLog, makeSandbox, stubFetch, type FetchStub, type Sandbox } from "./support/fixtures.ts"

let sandbox: Sandbox | undefined
let stub: FetchStub | undefined
let log: { lines: string[]; restore(): void } | undefined

function seeded(): Sandbox {
  const s = makeSandbox()
  s.writeAuth({
    zai: { type: "api", key: "zai-test" },
    nvidia: { type: "api", key: "nvidia-test" },
    orcarouter: { type: "api", key: "orca-test" },
    "cloudflare-workers-ai": { type: "api", key: "cf-test", metadata: { accountId: "acct-1" } },
    opencode: { type: "api", key: "oc-test" },
  })
  return s
}

async function output(argv: string[]): Promise<string> {
  log = captureLog()
  try {
    await cmdProbe(new Map(), argv.includes("--json"))
    return log.lines.join("\n")
  } finally {
    log.restore()
    log = undefined
  }
}

beforeEach(() => {
  sandbox = seeded()
})

afterEach(() => {
  log?.restore()
  log = undefined
  stub?.restore()
  stub = undefined
  sandbox?.cleanup()
  sandbox = undefined
})

describe("runProbes", () => {
  it("ranks the connected providers that have a free-model probe", async () => {
    stub = stubFetch((url) => ({
      body: url.includes("z.ai")
        ? { error: { code: "1113", message: "Insufficient balance or no resource package. Please recharge." } }
        : url.includes("orcarouter")
          ? { error: { code: "free_rate_limited", message: "Free model capacity is limited right now." } }
          : { result: { usage: { total_tokens: 5, neurons: 0.14, prompt_tokens_details: { cached_tokens: 0 } } } },
    }))
    const results = await runProbes()
    const names = results.map((r) => r.provider).sort()
    expect(names).toEqual(["cloudflare-workers-ai", "nvidia", "orcarouter", "zai"])
    const cf = results.find((r) => r.provider === "cloudflare-workers-ai")!
    expect(cf.status).toBe(200)
    expect(cf.ok).toBe(true)
    expect(cf.usage).toEqual({ total_tokens: 5, neurons: 0.14 })
  })

  it("keeps the retry window when the header and the body both carry it", async () => {
    stub = stubFetch(() => ({
      status: 429,
      headers: { "retry-after": "7726" },
      body: { error: { code: "free_rate_limited", message: "slow down", metadata: { retry_after_seconds: 7726 } } },
    }))
    const orca = (await runProbes()).find((r) => r.provider === "orcarouter")!
    expect(orca.ok).toBe(false)
    expect(orca.code).toBe("free_rate_limited")
    expect(orca.retryAfterSeconds).toBe(7726)
  })

  it("reads the retry window from the header when the body has none", async () => {
    stub = stubFetch(() => ({ status: 429, headers: { "retry-after": "120" }, body: { error: { code: "x" } } }))
    const orca = (await runProbes()).find((r) => r.provider === "orcarouter")!
    expect(orca.retryAfterSeconds).toBe(120)
  })

  it("reads the retry window from the body when the header is missing", async () => {
    stub = stubFetch(() => ({ status: 429, body: { error: { code: "x", metadata: { retry_after_seconds: 90 } } } }))
    const orca = (await runProbes()).find((r) => r.provider === "orcarouter")!
    expect(orca.retryAfterSeconds).toBe(90)
  })

  it("never leaks a key that a response echoes back", async () => {
    stub = stubFetch(() => ({ body: { error: { message: "bad key: zai-test denied" } } }))
    const zai = (await runProbes()).find((r) => r.provider === "zai")!
    expect(zai.message).toContain("[redacted]")
    expect(zai.message).not.toContain("zai-test")
  })

  it("keeps a short secret verbatim so a fixture key in the answer is not a leak", async () => {
    stub = stubFetch(() => ({ body: { error: { message: "bad key: abc denied" } } }))
    const zai = (await runProbes()).find((r) => r.provider === "zai")!
    expect(zai.message).toContain("abc")
  })

  it("treats a transport failure as status 0 with the message", async () => {
    stub = stubFetch(() => ({ throws: new Error("network down") }))
    const results = await runProbes()
    const zai = results.find((r) => r.provider === "zai")!
    expect(zai.status).toBe(0)
    expect(zai.ok).toBe(false)
    expect(zai.message).toBe("network down")
  })

  it("handles a body that is not json as an empty answer", async () => {
    stub = stubFetch(() => ({ text: "the server is a website, not an api" }))
    const results = await runProbes()
    const cf = results.find((r) => r.provider === "cloudflare-workers-ai")!
    expect(cf.status).toBe(200)
    expect(cf.ok).toBe(true)
    expect(cf.usage).toBeUndefined()
  })

  it("requires the account id for cloudflare before any call", async () => {
    sandbox!.writeAuth({ "cloudflare-workers-ai": { type: "api", key: "cf-test" } })
    stub = stubFetch(() => ({ body: {} }))
    const results = await runProbes()
    const cf = results.find((r) => r.provider === "cloudflare-workers-ai")!
    expect(cf.status).toBe(0)
    expect(cf.ok).toBe(false)
    expect(cf.message).toBe("metadata.accountId is required")
    expect(stub.calls).toEqual([])
  })

  it("skips a provider that has no key", async () => {
    sandbox!.writeAuth({ zai: { type: "api", key: "zai-test" }, opencode: { type: "api" } })
    stub = stubFetch(() => ({ body: { error: { code: "1113" } } }))
    const results = await runProbes()
    expect(results.map((r) => r.provider)).toEqual(["zai"])
  })
})

describe("probeTable", () => {
  it("renders an ok probe with its usage, and the retry on a failure", () => {
    const table = probeTable([
      { provider: "cloudflare-workers-ai", status: 200, ok: true, usage: { neurons: 0.14 } },
      { provider: "orcarouter", status: 429, ok: false, code: "free_rate_limited", message: "slow down", retryAfterSeconds: 7726 },
    ])
    expect(table).toContain("cloudflare-workers-ai")
    expect(table).toContain("neurons=0.14")
    expect(table).toContain("slow down")
    expect(table).toContain("3h")
  })

  it("renders an ok probe with no usage as plain http ok", () => {
    expect(probeTable([{ provider: "nvidia", status: 200, ok: true }])).toContain("http ok")
  })

  it("renders a failure with only the status when the body says nothing", () => {
    expect(probeTable([{ provider: "zai", status: 401, ok: false }])).toContain("HTTP 401")
  })

  it("renders the code when the body carries no message", () => {
    expect(probeTable([{ provider: "zai", status: 429, ok: false, code: "1113" }])).toContain("code 1113")
  })

  it("renders a transport failure as error with no retry", () => {
    expect(probeTable([{ provider: "zai", status: 0, ok: false, message: "timeout" }])).toContain("timeout")
  })

  it("renders a failure without a message as no signal", () => {
    expect(probeTable([{ provider: "zai", status: 0, ok: false }])).toContain("no signal")
  })
})

describe("fmtRetry", () => {
  it("formats seconds as seconds, minutes, hours and days", () => {
    expect(fmtRetry(45)).toBe("45s")
    expect(fmtRetry(120)).toBe("2m")
    expect(fmtRetry(3600)).toBe("1h")
    expect(fmtRetry(86_400)).toBe("1d")
  })
})

describe("cmdProbe", () => {
  it("prints the table and the providers without a probe", async () => {
    stub = stubFetch(() => ({ body: { error: { code: "1113", message: "Insufficient balance" } } }))
    const out = await output(["probe"])
    expect(out).toContain("PROVIDER")
    expect(out).toContain("zai")
    expect(out).toContain("no free-model probe: opencode")
  })

  it("emits json with the probe results", async () => {
    stub = stubFetch(() => ({ body: { error: { code: "1113", message: "Insufficient balance" } } }))
    const parsed = JSON.parse(await output(["probe", "--json"]))
    expect(parsed.probes.map((r: { provider: string }) => r.provider)).toContain("zai")
    expect(parsed.probes.find((r: { provider: string }) => r.provider === "zai").code).toBe("1113")
  })
})