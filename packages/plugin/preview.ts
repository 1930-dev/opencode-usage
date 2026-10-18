/**
 * Renders the /usage dialog headless, so a layout change can be seen without a
 * restart of opencode. Arguments are terminal widths; for each one the dialog is
 * rendered twice — once to learn which frame size the plugin asks for, then
 * again at exactly that width, which is what the host would give it.
 *
 * Run: bun run preview [terminal-width...]
 */
import { testRender } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import { Table } from "../../dist/tui.js"

const SIZE_WIDTH: Record<string, number> = { medium: 60, large: 88, xlarge: 116 }

/**
 * The slice of a ResolvedTheme the plugin reads, with the tokens OpenCode
 * resolves. RGBA stands in for whatever the real theme resolves to: `toHex`
 * only reads `r`, `g` and `b`.
 */
const rgb = (r: number, g: number, b: number) => ({ r, g, b })

const theme = {
  text: {
    base: rgb(0.9, 0.9, 0.9),
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

const snapshot: any = {
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

async function render(terminal: number, frame: number): Promise<{ size: string; lines: string[] }> {
  let size = ""
  const context: any = {
    renderer: { width: terminal },
    ui: { dialog: { set: (options: { size?: string }) => (size = options.size ?? size) } },
    theme,
  }
  const setup = await testRender(() => jsx(Table, { context, snapshot }), { width: frame, height: 24 })
  await setup.flush()
  const lines = setup.captureCharFrame().split("\n").map((l) => l.replace(/\s+$/, ""))
  setup.renderer.destroy?.()
  return { size, lines }
}

const widths = process.argv.slice(2).map(Number).filter(Boolean)
for (const terminal of widths.length ? widths : [200, 100, 70]) {
  const probe = await render(terminal, Math.max(terminal, 10))
  const frame = Math.min(SIZE_WIDTH[probe.size] ?? 60, terminal - 2)
  const { lines } = await render(terminal, frame)
  console.log(`\n${"─".repeat(frame)} terminal=${terminal} → ${probe.size} (${frame} cols)`)
  for (const line of lines) if (line) console.log("|" + line + "|")
}
process.exit(0)