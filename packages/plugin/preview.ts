/**
 * Renders the /usage dialog headless, at several widths, so a layout change can
 * be seen without a restart of opencode. Run: bun run preview
 */
import { testRender } from "@opentui/solid"
import { jsx } from "@opentui/solid/jsx-runtime"
import { Table } from "./dist/opencode-usage.js"

const api: any = {
  theme: {
    current: {
      text: { r: 0.93, g: 0.93, b: 0.93 },
      textMuted: { r: 0.43, g: 0.43, b: 0.43 },
      borderSubtle: { r: 0.18, g: 0.18, b: 0.18 },
      success: { r: 0.29, g: 0.87, b: 0.5 },
      warning: { r: 0.98, g: 0.8, b: 0.08 },
      error: { r: 0.97, g: 0.44, b: 0.44 },
    },
  },
}

const snapshot: any = {
  rows: [
    { group: "opencode-go", provider: "opencode-go", messages: 7, cost: 0, tokensInput: 0, tokensOutput: 0 },
    { group: "nvidia", provider: "nvidia", messages: 98, cost: 0, tokensInput: 10_900_000, tokensOutput: 19_900 },
    { group: "anthropic", provider: "anthropic", messages: 1, cost: 12.3456, tokensInput: 4_200, tokensOutput: 830 },
  ],
  totals: { messages: 106, cost: 12.3456 },
  pct: {
    "opencode-go": { pct: 100, source: "live", label: "weekly" },
    anthropic: { pct: 42, source: "budget", label: "monthly" },
  },
}

const widths = process.argv.slice(2).map(Number).filter(Boolean)
for (const width of widths.length ? widths : [50, 60, 80]) {
  const setup = await testRender(() => jsx(Table, { api, snapshot }), { width, height: 20 })
  await setup.flush()
  console.log(`\n${"─".repeat(width)} width=${width}`)
  for (const line of setup.captureCharFrame().split("\n")) console.log("|" + line.replace(/\s+$/, ""))
  setup.renderer.destroy?.()
}
process.exit(0)
