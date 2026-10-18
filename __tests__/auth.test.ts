import { describe, it, expect, afterEach } from "bun:test"
import { readAuth, authSecret } from "../packages/core/src/auth.ts"
import { makeSandbox, type Sandbox } from "./support/fixtures.ts"

let sandbox: Sandbox | undefined
afterEach(() => {
  sandbox?.cleanup()
  sandbox = undefined
})

describe("readAuth", () => {
  it("reads the credentials OpenCode V2 keeps in its database", async () => {
    sandbox = makeSandbox()
    sandbox.writeCredentials([
      { integration: "groq", value: { type: "key", key: "gsk-test" } },
      { integration: "cloudflare-workers-ai", value: { type: "key", key: "cfut-test", metadata: { accountId: "acct-1" } } },
    ])
    const store = await readAuth()
    expect(Object.keys(store).sort()).toEqual(["cloudflare-workers-ai", "groq"])
    expect(store.groq).toEqual({ type: "key", key: "gsk-test", metadata: undefined })
    expect(store["cloudflare-workers-ai"]?.metadata).toEqual({ accountId: "acct-1" })
  })

  it("prefers the database over the file V2 froze at migration", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ legacy: { type: "api", key: "stale" } })
    sandbox.writeCredentials([{ integration: "groq", value: { type: "key", key: "gsk-new" } }])
    const store = await readAuth()
    // The provider added after the migration is visible; the one only the file
    // knows about is not, because it may have been logged out of since.
    expect(Object.keys(store)).toEqual(["groq"])
    expect(authSecret(store.groq!)).toBe("gsk-new")
  })

  it("falls back to auth.json when the database holds none", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "gsk-file" } })
    sandbox.writeCredentials([])
    expect(authSecret((await readAuth()).groq!)).toBe("gsk-file")
  })

  it("falls back to auth.json on a V1 database, which has no credential table", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "gsk-v1" } })
    expect(authSecret((await readAuth()).groq!)).toBe("gsk-v1")
  })

  it("falls back to auth.json when the database cannot be opened", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "gsk-file" } })
    await Bun.write(sandbox.dbPath, "not a database")
    expect(authSecret((await readAuth()).groq!)).toBe("gsk-file")
  })

  it("reports when neither source can be read", async () => {
    sandbox = makeSandbox()
    await expect(readAuth()).rejects.toThrow(/cannot read opencode auth store/)
  })

  it("carries the access token of an OAuth account and leaves the refresh one behind", async () => {
    sandbox = makeSandbox()
    sandbox.writeCredentials([
      {
        integration: "github-copilot",
        value: { type: "oauth", methodID: "device", refresh: "ghr", access: "gho", expires: 123 },
      },
    ])
    const store = await readAuth()
    expect(store["github-copilot"]?.type).toBe("oauth")
    expect(authSecret(store["github-copilot"]!)).toBe("gho")
  })

  it("takes the newest row when an integration holds several accounts", async () => {
    sandbox = makeSandbox()
    sandbox.writeCredentials([
      { integration: "groq", value: { type: "key", key: "older" }, updatedMs: 1 },
      { integration: "groq", value: { type: "key", key: "newer" }, updatedMs: 2 },
    ])
    expect(authSecret((await readAuth()).groq!)).toBe("newer")
  })

  it("skips a row whose value is not a credential this package can use", async () => {
    sandbox = makeSandbox()
    sandbox.writeCredentials([
      { integration: "broken", value: "not json at all" },
      { integration: "external", value: { type: "external", methodID: "m" } },
      { integration: "groq", value: { type: "key", key: "gsk-test" } },
    ])
    const store = await readAuth()
    expect(Object.keys(store)).toEqual(["groq"])
  })

  it("treats a key with no type of its own as an API key", async () => {
    sandbox = makeSandbox()
    sandbox.writeCredentials([{ integration: "groq", value: { key: "gsk-untyped" } }])
    const store = await readAuth()
    expect(store.groq?.type).toBe("api")
    expect(authSecret(store.groq!)).toBe("gsk-untyped")
  })
})

describe("authSecret", () => {
  it("prefers the key and falls back to the access token", () => {
    expect(authSecret({ type: "key", key: "k", access: "a" })).toBe("k")
    expect(authSecret({ type: "oauth", access: "a" })).toBe("a")
    expect(authSecret({ type: "key" })).toBeUndefined()
  })
})