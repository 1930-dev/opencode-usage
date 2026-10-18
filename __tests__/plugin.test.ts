import { describe, it, expect } from "bun:test"
import plugin from "../packages/plugin/plugin.ts"

describe("plugin", () => {
  it("declares an id, so the package is identifiable", () => {
    expect(plugin.id).toBe("opencode-usage.server")
  })

  it("accepts a setup call and registers nothing", () => {
    expect(plugin.setup({} as never)).toBeUndefined()
  })
})