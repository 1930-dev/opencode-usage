/** @jsxImportSource @opentui/solid */
import { describe, it, expect, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import plugin, { Message, Table, innerWidth, neededWidth, palette, show, terminalWidth, tui } from "../packages/plugin/tui.tsx"
import { SIZE_WIDTH } from "../packages/plugin/layout.ts"
import { makeSandbox, stubFetch, type FetchStub, type Sandbox } from "./support/fixtures.ts"

type Api = Parameters<typeof palette>[0]

const THEME = {
  primary: { r: 0.79, g: 0.55, b: 0.24 },
  text: { r: 0.1, g: 0.1, b: 0.1 },
  textMuted: { r: 0.45, g: 0.45, b: 0.45 },
  borderSubtle: { r: 0.8, g: 0.8, b: 0.8 },
  success: { r: 0.1, g: 0.6, b: 0.3 },
  warning: { r: 0.7, g: 0.5, b: 0 },
  error: { r: 0.8, g: 0.2, b: 0.2 },
}

const SNAPSHOT: any = {
  rows: [
    { provider: "opencode-go", messages: 7, cost: 0, tokensInput: 0, tokensOutput: 0 },
    { provider: "nvidia", messages: 98, cost: 0, tokensInput: 10_900_000, tokensOutput: 19_900 },
    { provider: "cloudflare-workers-ai", messages: 0, cost: 0, tokensInput: 0, tokensOutput: 0 },
    { provider: "github-copilot", messages: 1, cost: 12.3456, tokensInput: 4_200, tokensOutput: 830 },
  ],
  totals: { messages: 106, cost: 12.3456 },
  pct: {
    "opencode-go": { pct: 100, source: "live", label: "weekly" },
    "github-copilot": { pct: 42, source: "limits", label: "1,000,000 tokens/day" },
  },
}

interface FakeApi {
  api: Api
  sizes: string[]
}

function fakeApi(terminal: number, theme: unknown = THEME): FakeApi {
  const sizes: string[] = []
  return {
    sizes,
    api: {
      renderer: { width: terminal },
      ui: { dialog: { setSize: (s: string) => sizes.push(s) } },
      theme: { current: theme },
    } as unknown as Api,
  }
}

/**
 * Renders a component the way the host would, and returns its visible lines.
 * It takes a factory rather than a node: opentui creates elements against the
 * renderer in context, so a node built outside `testRender` has none.
 */
async function render(node: () => unknown, frame: number): Promise<string[]> {
  const setup = await testRender(node as never, { width: frame, height: 24 })
  await setup.flush()
  const lines = setup
    .captureCharFrame()
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0)
  setup.renderer.destroy?.()
  return lines
}

let sandbox: Sandbox | undefined
let stub: FetchStub | undefined

afterEach(() => {
  stub?.restore()
  stub = undefined
  sandbox?.cleanup()
  sandbox = undefined
})

describe("palette", () => {
  it("converts every theme color to a hex string", () => {
    const p = palette(fakeApi(100).api)
    expect(p.accent).toBe("#c98c3d")
    expect(Object.values(p).every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  })

  it("falls back to its own colors when the host exposes no theme", () => {
    expect(palette({} as Api).accent).toBe("#a277ff")
    expect(palette(fakeApi(100, null).api).text).toBe("#e5e5e5")
  })
})

describe("terminalWidth", () => {
  it("reads the renderer", () => {
    expect(terminalWidth(fakeApi(137).api)).toBe(137)
  })

  it("assumes the smallest frame when the host exposes no renderer", () => {
    expect(terminalWidth({} as Api)).toBe(SIZE_WIDTH.medium)
    expect(terminalWidth({ renderer: {} } as Api)).toBe(SIZE_WIDTH.medium)
  })
})

describe("innerWidth", () => {
  it("takes the frame it chose, less the padding", () => {
    expect(innerWidth(fakeApi(200).api, 60)).toBe(SIZE_WIDTH.large - 2)
  })

  it("never asks for more than the terminal holds", () => {
    expect(innerWidth(fakeApi(50).api, 60)).toBe(46)
  })
})

describe("neededWidth", () => {
  it("sizes to the longest budget label", () => {
    const short: any = { rows: [], totals: {}, pct: { a: { pct: 1, source: "live", label: "wk" } } }
    expect(neededWidth(SNAPSHOT)).toBeGreaterThan(neededWidth(short))
  })

  it("uses the source when a provider reports no label", () => {
    const noLabel: any = { rows: [], totals: {}, pct: { a: { pct: 1, source: "budgets" } } }
    expect(neededWidth(noLabel)).toBe(neededWidth({ rows: [], totals: {}, pct: { a: { pct: 1, source: "x", label: "budgets" } } } as any))
  })

  it("handles a snapshot with no percentages at all", () => {
    expect(neededWidth({ rows: [], totals: { messages: 0, cost: 0 } } as any)).toBeGreaterThan(0)
  })
})

describe("Table", () => {
  it("draws a header, every row, the bars and the total", async () => {
    const { api, sizes } = fakeApi(200)
    const lines = await render(() => jsx(Table, { api, snapshot: SNAPSHOT }), SIZE_WIDTH.large)
    expect(sizes).toContain("large")
    expect(lines[0]).toContain("Usage — today")
    expect(lines[0]).toContain("esc")
    expect(lines[1]).toContain("PROVIDER")
    expect(lines[1]).toContain("TOK OUT")
    const copilot = lines.find((l) => l.includes("github-copilot"))!
    expect(copilot).toContain("$12.35")
    expect(copilot).toContain("█")
    expect(copilot).toContain("42%")
    const zen = lines.find((l) => l.includes("opencode-go"))!
    expect(zen).toContain("100% weekly")
    expect(zen).not.toContain("░")
    expect(lines.at(-1)).toContain("TOTAL")
    expect(lines.at(-1)).toContain("106")
  })

  it("uses the compact headers in a narrow terminal", async () => {
    const { api, sizes } = fakeApi(70)
    const lines = await render(() => jsx(Table, { api, snapshot: SNAPSHOT }), SIZE_WIDTH.medium)
    expect(sizes).toContain("medium")
    expect(lines[1]).toContain("OUT")
    expect(lines[1]).not.toContain("TOK OUT")
  })

  it("asks for the widest frame only when a label needs it", async () => {
    const long: any = { ...SNAPSHOT, pct: { "opencode-go": { pct: 50, source: "limits", label: "1,000,000,000 tokens/day and then some more" } } }
    const { api, sizes } = fakeApi(200)
    await render(() => jsx(Table, { api, snapshot: long }), SIZE_WIDTH.xlarge)
    expect(sizes).toContain("xlarge")
  })

  it("leaves the budget column empty for a provider with no source", async () => {
    const { api } = fakeApi(200)
    const lines = await render(() => jsx(Table, { api, snapshot: SNAPSHOT }), SIZE_WIDTH.large)
    expect(lines.find((l) => l.includes("nvidia"))).not.toContain("█")
  })

  it("stops at 20 rows", async () => {
    const many: any = {
      rows: Array.from({ length: 30 }, (_, i) => ({ provider: `provider-${i}`, messages: 1, cost: 0, tokensInput: 0, tokensOutput: 0 })),
      totals: { messages: 30, cost: 0 },
    }
    const { api } = fakeApi(200)
    const lines = await render(() => jsx(Table, { api, snapshot: many }), SIZE_WIDTH.large)
    expect(lines.filter((l) => l.includes("provider-"))).toHaveLength(20)
  })

  it("renders a snapshot with no rows at all", async () => {
    const { api } = fakeApi(200)
    const lines = await render(() => jsx(Table, { api, snapshot: { rows: [], totals: { messages: 0, cost: 0 } } as any }), SIZE_WIDTH.large)
    expect(lines.at(-1)).toContain("TOTAL")
  })
})

describe("Message", () => {
  it("draws the text inside the frame", async () => {
    const { api } = fakeApi(200)
    const lines = await render(() => jsx(Message, { api, text: "Loading usage…" }), SIZE_WIDTH.large)
    expect(lines[0]).toContain("Usage — today")
    expect(lines.some((l) => l.includes("Loading usage…"))).toBe(true)
  })

  it("takes a color when it is given one", async () => {
    const { api } = fakeApi(200)
    const lines = await render(() => jsx(Message, { api, text: "Boom", color: "#ff0000" }), SIZE_WIDTH.large)
    expect(lines.some((l) => l.includes("Boom"))).toBe(true)
  })
})

describe("show", () => {
  function fakeDialog(): { replace: (fn: () => unknown) => void; frames: (() => unknown)[] } {
    const frames: (() => unknown)[] = []
    return { frames, replace: (fn: () => unknown) => frames.push(fn) }
  }

  it("shows a loading frame and then the table", async () => {
    sandbox = makeSandbox([{ provider: "groq", cost: 1, createdMs: Date.now() }])
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    stub = stubFetch(() => ({ status: 500 }))
    const dialog = fakeDialog()
    await show(fakeApi(200).api, dialog as never)
    expect(dialog.frames).toHaveLength(2)
    const lines = await render(dialog.frames[1]!, SIZE_WIDTH.large)
    expect(lines.some((l) => l.includes("groq"))).toBe(true)
  })

  it("shows why it could not read the usage", async () => {
    sandbox = makeSandbox()
    await Bun.write(sandbox.dbPath, "not a database")
    const dialog = fakeDialog()
    await show(fakeApi(200).api, dialog as never)
    const lines = await render(dialog.frames[1]!, SIZE_WIDTH.large)
    expect(lines.some((l) => l.includes("Failed to read usage"))).toBe(true)
  })
})

describe("tui", () => {
  const command = {
    title: "Usage",
    slashName: "usage",
  }

  it("registers a keymap layer when the host has one", async () => {
    const layers: any[] = []
    const api: any = { ...fakeApi(100).api, keymap: { registerLayer: (l: unknown) => layers.push(l) } }
    await tui(api)
    expect(layers).toHaveLength(1)
    const registered = layers[0].commands[0]
    expect(registered).toMatchObject({ title: command.title, slashName: command.slashName, namespace: "palette" })
    expect(typeof registered.run).toBe("function")
  })

  it("falls back to the command registry on an older host", async () => {
    const registered: any[] = []
    const api: any = { ...fakeApi(100).api, keymap: {}, command: { register: (fn: () => unknown[]) => registered.push(...fn()) } }
    await tui(api)
    expect(registered[0]).toMatchObject({ title: "Usage", value: "opencode-usage.show" })
    expect(registered[0].slash).toEqual({ name: "usage" })
    expect(typeof registered[0].onSelect).toBe("function")
  })

  it("does not fail on a host that offers neither", async () => {
    const api: any = { ...fakeApi(100).api, keymap: {} }
    await expect(tui(api)).resolves.toBeUndefined()
  })

  it("opens the dialog from either registration path", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    stub = stubFetch(() => ({ status: 500 }))
    const frames: (() => unknown)[] = []
    const dialog = { replace: (fn: () => unknown) => frames.push(fn) }
    const layers: any[] = []
    const api: any = {
      renderer: { width: 100 },
      ui: { dialog: { ...dialog, setSize: () => {} } },
      theme: { current: THEME },
      keymap: { registerLayer: (l: unknown) => layers.push(l) },
    }
    await tui(api)
    await layers[0].commands[0].run()
    expect(frames.length).toBeGreaterThan(0)

    const registered: any[] = []
    const legacy: any = { ...api, keymap: {}, command: { register: (fn: () => unknown[]) => registered.push(...fn()) } }
    await tui(legacy)
    await registered[0].onSelect(undefined)
    await registered[0].onSelect({ ...dialog, setSize: () => {} })
    expect(frames.length).toBeGreaterThan(2)
  })

  it("exports the module shape opencode loads", () => {
    expect(plugin.id).toBe("opencode-usage")
    expect(plugin.tui).toBe(tui)
  })
})
