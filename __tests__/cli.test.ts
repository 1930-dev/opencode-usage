import { describe, it, expect, afterEach } from "bun:test"
import { CliError, cmdTop, parseArgs, run, USAGE } from "../packages/cli/src/main.ts"
import { captureLog, makeSandbox, stubFetch, type FetchStub, type MessageSeed, type Sandbox } from "./support/fixtures.ts"

const DAY = 86_400_000
const NOW = Date.now()

const SEEDS: MessageSeed[] = [
  { provider: "openrouter", model: "gpt-5", agent: "build", cwd: "/repo/a", cost: 2, input: 1000, output: 100, createdMs: NOW - 2 * DAY },
  { provider: "groq", model: "llama", agent: "plan", cwd: "/repo/b", cost: 1, input: 500, output: 50, createdMs: NOW - 60_000 },
]

const MODELS_DEV = {
  openai: { models: { "gpt-5": { id: "gpt-5", name: "GPT-5", cost: { input: 1.25, output: 10 } } } },
  free: { models: { "no-price": { id: "no-price", name: "Free", cost: { input: 0, output: 0 } } } },
}

let sandbox: Sandbox | undefined
let stub: FetchStub | undefined
let log: ReturnType<typeof captureLog> | undefined

function seeded(): Sandbox {
  const s = makeSandbox(SEEDS)
  s.writeAuth({ openrouter: { type: "api", key: "o" }, groq: { type: "api", key: "g" } })
  return s
}

/** Runs a command with stdout captured, and returns everything it printed. */
async function output(argv: string[]): Promise<string> {
  log = captureLog()
  try {
    await run(argv)
    return log.lines.join("\n")
  } finally {
    log.restore()
    log = undefined
  }
}

afterEach(() => {
  log?.restore()
  log = undefined
  stub?.restore()
  stub = undefined
  sandbox?.cleanup()
  sandbox = undefined
})

describe("parseArgs", () => {
  it("reads the command and its boolean flags", () => {
    expect(parseArgs(["usage", "--json", "--today"])).toEqual({
      cmd: "usage",
      flags: new Map([["--json", true], ["--today", true]]),
    })
  })

  it("reads a value written with an equals sign", () => {
    expect(parseArgs(["usage", "--since=30d"]).flags.get("--since")).toBe("30d")
  })

  it("reads a value written as the next argument, for the flags that take one", () => {
    expect(parseArgs(["usage", "--by", "agent"]).flags.get("--by")).toBe("agent")
    expect(parseArgs(["top", "--limit", "5"]).flags.get("--limit")).toBe("5")
  })

  it("does not swallow the next argument for a flag that takes no value", () => {
    expect(() => parseArgs(["usage", "--json", "extra"])).toThrow("unexpected argument: extra")
  })

  it("treats a trailing valued flag with nothing after it as a boolean", () => {
    expect(parseArgs(["usage", "--since"]).flags.get("--since")).toBe(true)
  })

  it("rejects a missing command, and a first argument that is a flag", () => {
    expect(() => parseArgs([])).toThrow("missing command")
    expect(() => parseArgs(["--json"])).toThrow("missing command")
    expect(() => parseArgs([])).toThrow(CliError)
  })

  it("rejects a bare argument where a flag belongs", () => {
    expect(() => parseArgs(["usage", "today"])).toThrow("unexpected argument: today")
  })

  it("prints the whole help when the command is missing", () => {
    expect(() => parseArgs([])).toThrow(USAGE.trim().split("\n")[0]!)
  })
})

describe("run", () => {
  it("rejects a command it does not have", async () => {
    await expect(run(["nope"])).rejects.toThrow("unknown command: nope")
  })
})

describe("usage", () => {
  it("defaults to the last 7 days grouped by provider", async () => {
    sandbox = seeded()
    const out = await output(["usage"])
    expect(out).toContain("PROVIDER")
    expect(out.indexOf("openrouter")).toBeLessThan(out.indexOf("groq"))
    expect(out).toContain("TOTAL since 7d")
  })

  it("narrows to today", async () => {
    sandbox = seeded()
    const out = await output(["usage", "--today"])
    expect(out).toContain("TOTAL since today")
    expect(out).toContain("groq")
  })

  it("honours an explicit window", async () => {
    sandbox = seeded()
    expect(await output(["usage", "--since", "30d"])).toContain("TOTAL since 30d")
  })

  it("rejects a window it cannot parse", async () => {
    sandbox = seeded()
    await expect(run(["usage", "--since", "banana"])).rejects.toThrow("invalid duration")
  })

  it("rejects --since with no value", async () => {
    sandbox = seeded()
    await expect(run(["usage", "--since"])).rejects.toThrow("--since needs a value like 7d")
  })

  it("groups by each supported dimension", async () => {
    sandbox = seeded()
    expect(await output(["usage", "--by", "agent"])).toContain("AGENT")
    expect(await output(["usage", "--by", "day"])).toContain("DAY")
    expect(await output(["usage", "--by", "model"])).toContain("openrouter/gpt-5")
    expect(await output(["usage", "--by", "project"])).toContain("/repo/a")
  })

  it("rejects a grouping it does not have", async () => {
    sandbox = seeded()
    await expect(run(["usage", "--by", "galaxy"])).rejects.toThrow("invalid --by: galaxy")
  })

  it("adds the budget column with --pct", async () => {
    sandbox = seeded()
    sandbox.writeBudgets({ openrouter: 4 })
    stub = stubFetch(() => ({ status: 500 }))
    expect(await output(["usage", "--pct"])).toContain("% BUDGET")
  })

  it("refuses --pct for a grouping where a provider budget means nothing", async () => {
    sandbox = seeded()
    await expect(run(["usage", "--pct", "--by", "day"])).rejects.toThrow("--pct only supported with --by provider")
  })

  it("emits json carrying the window, the rows and the totals", async () => {
    sandbox = seeded()
    const parsed = JSON.parse(await output(["usage", "--json"]))
    expect(parsed.groupBy).toBe("provider")
    expect(new Date(parsed.since).getTime()).toBeLessThan(Date.now())
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.totals.messages).toBe(2)
    expect(parsed.pct).toBeUndefined()
  })

  it("carries the percentages into json too", async () => {
    sandbox = seeded()
    sandbox.writeBudgets({ openrouter: 4 })
    stub = stubFetch(() => ({ status: 500 }))
    const parsed = JSON.parse(await output(["usage", "--json", "--pct"]))
    expect(parsed.pct.openrouter.source).toBe("budgets")
  })
})

describe("providers", () => {
  it("lists every connected provider with its local usage", async () => {
    sandbox = seeded()
    stub = stubFetch(() => ({ status: 500 }))
    const out = await output(["providers"])
    expect(out).toContain("PROVIDER")
    expect(out).toContain("openrouter")
    expect(out).toContain("LAST USED")
  })

  it("skips the network with --no-net", async () => {
    sandbox = seeded()
    stub = stubFetch(() => ({ body: {} }))
    await output(["providers", "--no-net"])
    expect(stub.calls).toEqual([])
  })

  it("emits json with the statuses and the local usage", async () => {
    sandbox = seeded()
    const parsed = JSON.parse(await output(["providers", "--no-net", "--json"]))
    expect(parsed.statuses.map((s: { provider: string }) => s.provider)).toEqual(["groq", "openrouter"])
    expect(parsed.local.openrouter.messages).toBe(1)
  })
})

describe("top", () => {
  it("prints the table and credits the sources", async () => {
    sandbox = makeSandbox()
    stub = stubFetch(() => ({ body: MODELS_DEV }))
    const out = await output(["top"])
    expect(out).toContain("MODEL")
    expect(out).toContain("IQ/$")
    expect(out).toContain("GPT-5")
    expect(out).toContain("Artificial Analysis")
    // No key, so there is no index and no value score to show.
    expect(out).toContain("—")
  })

  it("honours --limit", async () => {
    sandbox = makeSandbox()
    stub = stubFetch(() => ({
      body: { a: { models: { one: { id: "one", name: "One", cost: { input: 1, output: 1 } }, two: { id: "two", name: "Two", cost: { input: 2, output: 2 } } } } },
    }))
    const body = (await output(["top", "--limit", "1"])).split("\n")
    expect(body.filter((l) => l.startsWith("one") || l.startsWith("two"))).toHaveLength(1)
  })

  it("rejects a limit that is not a positive number", async () => {
    sandbox = makeSandbox()
    await expect(cmdTop(new Map([["--limit", "zero"]]), false)).rejects.toThrow("invalid --limit: zero")
    await expect(cmdTop(new Map([["--limit", "0"]]), false)).rejects.toThrow("invalid --limit: 0")
    await expect(cmdTop(new Map([["--limit", "-3"]]), false)).rejects.toThrow("invalid --limit: -3")
  })

  it("emits json with the attribution alongside the models", async () => {
    sandbox = makeSandbox()
    stub = stubFetch(() => ({ body: MODELS_DEV }))
    const parsed = JSON.parse(await output(["top", "--json"]))
    expect(parsed.attribution).toContain("models.dev")
    expect(parsed.models[0].model).toBe("gpt-5")
  })

  it("shows the index and the value score once a key is configured", async () => {
    sandbox = makeSandbox()
    const previous = process.env.AA_API_KEY
    process.env.AA_API_KEY = "aa-test-key"
    try {
      stub = stubFetch((url) => ({
        body: url.includes("models.dev")
          ? MODELS_DEV
          : { data: [{ id: "1", slug: "gpt-5", name: "GPT-5", evaluations: { artificial_analysis_intelligence_index: 68, artificial_analysis_coding_index: 70 } }] },
      }))
      const out = await output(["top"])
      expect(out).toMatch(/GPT-5\s+68\s+70/)
    } finally {
      if (previous === undefined) delete process.env.AA_API_KEY
      else process.env.AA_API_KEY = previous
    }
  })
})
