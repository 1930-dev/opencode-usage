/** @jsxImportSource @opentui/solid */
import { describe, it, expect, afterEach } from "bun:test"
import { testRender } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import plugin, { Message, Table, innerWidth, neededWidth, palette, show, terminalWidth } from "../packages/plugin/tui.tsx"
import { SIZE_WIDTH } from "../packages/plugin/layout.ts"
import { makeSandbox, stubFetch, type FetchStub, type Sandbox } from "./support/fixtures.ts"

type Context = Parameters<typeof palette>[0]

const rgb = (r: number, g: number, b: number) => ({ r, g, b })

/** The theme tokens the plugin reads, with the values the old V1 theme carried. */
const THEME = {
  text: {
    base: rgb(0.1, 0.1, 0.1),
    muted: rgb(0.45, 0.45, 0.45),
    action: { primary: { base: rgb(0.79, 0.55, 0.24) } },
    feedback: {
      success: { base: rgb(0.1, 0.6, 0.3) },
      warning: { base: rgb(0.7, 0.5, 0) },
      error: { base: rgb(0.8, 0.2, 0.2) },
    },
  },
  border: { base: rgb(0.8, 0.8, 0.8) },
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

interface FakeContext {
  context: Context
  sizes: string[]
}

function fakeContext(terminal: number, theme: unknown = THEME): FakeContext {
  const sizes: string[] = []
  return {
    sizes,
    context: {
      renderer: { width: terminal },
      ui: { dialog: { set: (options: { size?: string }) => sizes.push(options.size ?? "") } },
      theme,
    } as unknown as Context,
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
  it("converts every theme token to a hex string", () => {
    const p = palette(fakeContext(100).context)
    expect(p.accent).toBe("#c98c3d")
    expect(Object.values(p).every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  })

  it("falls back to its own colors when the host exposes no theme", () => {
    expect(palette({} as Context).accent).toBe("#a277ff")
    expect(palette(fakeContext(100, null).context).text).toBe("#e5e5e5")
  })

  it("falls back per token when the theme is only partly resolved", () => {
    const partial = { text: { base: rgb(0, 0, 0) } }
    const p = palette({ theme: partial } as unknown as Context)
    expect(p.text).toBe("#000000")
    expect(p.accent).toBe("#a277ff")
    expect(p.warn).toBe("#facc15")
  })
})

describe("terminalWidth", () => {
  it("reads the renderer", () => {
    expect(terminalWidth(fakeContext(137).context)).toBe(137)
  })

  it("assumes the smallest frame when the host exposes no renderer", () => {
    expect(terminalWidth({} as Context)).toBe(SIZE_WIDTH.medium)
    expect(terminalWidth({ renderer: {} } as unknown as Context)).toBe(SIZE_WIDTH.medium)
  })
})

describe("innerWidth", () => {
  it("takes the frame it chose, less the padding", () => {
    expect(innerWidth(fakeContext(200).context, 60)).toBe(SIZE_WIDTH.large - 4)
  })

  it("never asks for more than the terminal holds", () => {
    expect(innerWidth(fakeContext(50).context, 60)).toBe(44)
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
    const { context, sizes } = fakeContext(200)
    const lines = await render(() => jsx(Table, { context, snapshot: SNAPSHOT }), SIZE_WIDTH.large)
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
    const { context, sizes } = fakeContext(70)
    const lines = await render(() => jsx(Table, { context, snapshot: SNAPSHOT }), SIZE_WIDTH.medium)
    expect(sizes).toContain("medium")
    expect(lines[1]).toContain("OUT")
    expect(lines[1]).not.toContain("TOK OUT")
  })

  it("asks for the widest frame only when a label needs it", async () => {
    const long: any = { ...SNAPSHOT, pct: { "opencode-go": { pct: 50, source: "limits", label: "1,000,000,000 tokens/day and then some more" } } }
    const { context, sizes } = fakeContext(200)
    await render(() => jsx(Table, { context, snapshot: long }), SIZE_WIDTH.xlarge)
    expect(sizes).toContain("xlarge")
  })

  it("leaves the budget column empty for a provider with no source", async () => {
    const { context } = fakeContext(200)
    const lines = await render(() => jsx(Table, { context, snapshot: SNAPSHOT }), SIZE_WIDTH.large)
    expect(lines.find((l) => l.includes("nvidia"))).not.toContain("█")
  })

  it("stops at 20 rows", async () => {
    const many: any = {
      rows: Array.from({ length: 30 }, (_, i) => ({ provider: `provider-${i}`, messages: 1, cost: 0, tokensInput: 0, tokensOutput: 0 })),
      totals: { messages: 30, cost: 0 },
    }
    const { context } = fakeContext(200)
    const lines = await render(() => jsx(Table, { context, snapshot: many }), SIZE_WIDTH.large)
    expect(lines.filter((l) => l.includes("provider-"))).toHaveLength(20)
  })

  it("renders a snapshot with no rows at all", async () => {
    const { context } = fakeContext(200)
    const lines = await render(() => jsx(Table, { context, snapshot: { rows: [], totals: { messages: 0, cost: 0 } } as any }), SIZE_WIDTH.large)
    expect(lines.at(-1)).toContain("TOTAL")
  })
})

describe("Message", () => {
  it("draws the text inside the frame", async () => {
    const { context } = fakeContext(200)
    const lines = await render(() => jsx(Message, { context, text: "Loading usage…" }), SIZE_WIDTH.large)
    expect(lines[0]).toContain("Usage — today")
    expect(lines.some((l) => l.includes("Loading usage…"))).toBe(true)
  })

  it("takes a color when it is given one", async () => {
    const { context } = fakeContext(200)
    const lines = await render(() => jsx(Message, { context, text: "Boom", color: "#ff0000" }), SIZE_WIDTH.large)
    expect(lines.some((l) => l.includes("Boom"))).toBe(true)
  })
})

describe("show", () => {
  /** V2 has no `replace`: showing a dialog again is what swaps the content. */
  function fakeDialog(): { show: (fn: () => unknown) => void; frames: (() => unknown)[] } {
    const frames: (() => unknown)[] = []
    return { frames, show: (fn: () => unknown) => frames.push(fn) }
  }

  it("shows a loading frame and then the table", async () => {
    sandbox = makeSandbox([{ provider: "groq", cost: 1, createdMs: Date.now() }])
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    stub = stubFetch(() => ({ status: 500 }))
    const dialog = fakeDialog()
    const { context } = fakeContext(200)
    ;(context as any).ui.dialog.show = dialog.show
    await show(context)
    expect(dialog.frames).toHaveLength(2)
    const lines = await render(dialog.frames[1]!, SIZE_WIDTH.large)
    expect(lines.some((l) => l.includes("groq"))).toBe(true)
  })

  it("shows why it could not read the usage", async () => {
    sandbox = makeSandbox()
    await Bun.write(sandbox.dbPath, "not a database")
    const dialog = fakeDialog()
    const { context } = fakeContext(200)
    ;(context as any).ui.dialog.show = dialog.show
    await show(context)
    const lines = await render(dialog.frames[1]!, SIZE_WIDTH.large)
    expect(lines.some((l) => l.includes("Failed to read usage"))).toBe(true)
  })
})

describe("plugin", () => {
  function host(): { context: Context; layers: any[] } {
    const layers: any[] = []
    const { context } = fakeContext(100)
    ;(context as any).keymap = { layer: (factory: () => unknown) => layers.push(factory()) }
    return { context, layers }
  }

  it("declares a stable id", () => {
    expect(plugin.id).toBe("opencode-usage")
  })

  it("registers a global keymap layer holding the palette and slash command", () => {
    const { context, layers } = host()
    plugin.setup(context)
    expect(layers).toHaveLength(1)
    expect(layers[0].mode).toBe("global")
    const command = layers[0].commands[0]
    expect(command).toMatchObject({
      id: "opencode-usage.usage",
      title: "Usage",
      group: "Usage",
      palette: true,
      slash: { name: "usage" },
    })
    expect(typeof command.run).toBe("function")
  })

  it("opens the dialog when the command runs", async () => {
    sandbox = makeSandbox()
    sandbox.writeAuth({ groq: { type: "api", key: "g" } })
    stub = stubFetch(() => ({ status: 500 }))
    const { context, layers } = host()
    const frames: (() => unknown)[] = []
    ;(context as any).ui.dialog.show = (fn: () => unknown) => frames.push(fn)
    plugin.setup(context)
    await layers[0].commands[0].run()
    expect(frames.length).toBeGreaterThan(0)
    const lines = await render(frames.at(-1)!, SIZE_WIDTH.large)
    expect(lines.some((l) => l.includes("groq"))).toBe(true)
  })
})