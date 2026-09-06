import { describe, it, expect, afterEach } from "bun:test"
import { authPath, budgetsPath, cacheDir, dbPath } from "../packages/core/src/config.ts"
import { authSecret, readAuth } from "../packages/core/src/auth.ts"
import { makeSandbox, type Sandbox } from "./support/fixtures.ts"

const KEYS = ["OPENCODE_DB_PATH", "OPENCODE_AUTH_PATH", "OPENCODE_USAGE_CACHE", "OPENCODE_USAGE_BUDGETS", "HOME"] as const

function withEnv(env: Partial<Record<(typeof KEYS)[number], string | undefined>>, body: () => void): void {
  const previous = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    body()
  } finally {
    for (const k of KEYS) {
      const v = previous[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe("config", () => {
  it("derives every path from HOME by default", () => {
    withEnv(
      {
        HOME: "/home/tester",
        OPENCODE_DB_PATH: undefined,
        OPENCODE_AUTH_PATH: undefined,
        OPENCODE_USAGE_CACHE: undefined,
        OPENCODE_USAGE_BUDGETS: undefined,
      },
      () => {
        expect(dbPath()).toBe("/home/tester/.local/share/opencode/opencode.db")
        expect(authPath()).toBe("/home/tester/.local/share/opencode/auth.json")
        expect(cacheDir()).toBe("/home/tester/.cache/opencode-usage")
        expect(budgetsPath()).toBe("/home/tester/.config/opencode-usage/budgets.json")
      },
    )
  })

  it("prefers the environment override over HOME", () => {
    withEnv(
      {
        HOME: "/home/tester",
        OPENCODE_DB_PATH: "/elsewhere/db.sqlite",
        OPENCODE_AUTH_PATH: "/elsewhere/auth.json",
        OPENCODE_USAGE_CACHE: "/elsewhere/cache",
        OPENCODE_USAGE_BUDGETS: "/elsewhere/budgets.json",
      },
      () => {
        expect(dbPath()).toBe("/elsewhere/db.sqlite")
        expect(authPath()).toBe("/elsewhere/auth.json")
        expect(cacheDir()).toBe("/elsewhere/cache")
        expect(budgetsPath()).toBe("/elsewhere/budgets.json")
      },
    )
  })

  it("fails loudly when HOME is not set and no override is given", () => {
    withEnv(
      {
        HOME: undefined,
        OPENCODE_DB_PATH: undefined,
        OPENCODE_AUTH_PATH: undefined,
        OPENCODE_USAGE_CACHE: undefined,
        OPENCODE_USAGE_BUDGETS: undefined,
      },
      () => {
        expect(() => dbPath()).toThrow("HOME is not set")
        expect(() => authPath()).toThrow("HOME is not set")
        expect(() => cacheDir()).toThrow("HOME is not set")
        expect(() => budgetsPath()).toThrow("HOME is not set")
      },
    )
  })
})

describe("auth", () => {
  let sandbox: Sandbox | undefined

  afterEach(() => {
    sandbox?.cleanup()
    sandbox = undefined
  })

  it("reads the store", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ openrouter: { type: "api", key: "sk-test" } })
    expect(await readAuth()).toEqual({ openrouter: { type: "api", key: "sk-test" } })
  })

  it("reports a missing store rather than returning empty", async () => {
    sandbox = makeSandbox()
    await expect(readAuth()).rejects.toThrow("cannot read opencode auth store")
  })

  it("takes the key, then the access token, and otherwise nothing", () => {
    expect(authSecret({ type: "api", key: "k" })).toBe("k")
    expect(authSecret({ type: "oauth", access: "a" })).toBe("a")
    expect(authSecret({ type: "api", key: "k", access: "a" })).toBe("k")
    expect(authSecret({ type: "wellknown" })).toBeUndefined()
  })
})
