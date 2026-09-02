/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const CLI = `${process.env.HOME}/Code/opencode-usage/packages/cli/src/cli.ts`

interface UsageRow {
  group: string
  provider: string
  messages: number
  cost: number
  tokensInput: number
  tokensOutput: number
}

interface PctInfo {
  pct: number
  source: string
  label?: string
}

interface UsageJson {
  since: string
  rows: UsageRow[]
  totals: { messages: number; cost: number }
  pct?: Record<string, PctInfo>
}

function fmtT(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function progressBar(pct: number, width = 14): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * width)
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, width - filled))
}

function barColor(pct: number): string {
  if (pct >= 90) return "#f87171"
  if (pct >= 70) return "#facc15"
  return "#4ade80"
}

export const tui: TuiPlugin = async (api) => {
  api.command.register(() => [
    {
      title: "Show usage",
      value: "opencode-usage.show",
      slash: { name: "usage" },
      onSelect: async (dialog) => {
        const cols = ["PROVIDER", "MSGS", "TOK IN", "TOK OUT", "EST COST", "BUDGET"]
        const widths = [20, 5, 8, 8, 10, 22]
        const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length))
        const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join("  ")

        const proc = Bun.spawn(["bun", CLI, "usage", "--pct", "--today"], { stdout: "pipe", stderr: "pipe" })
        const out = await new Response(proc.stdout).text()
        await proc.exited

        let snap: UsageJson
        try {
          snap = JSON.parse(out)
        } catch {
          dialog.replace(() => <text>Failed to load usage data — is opencode-usage installed?</text>)
          return
        }

        dialog.replace(() => (
          <api.ui.Dialog size="xlarge" onClose={() => api.ui.dialog.clear()}>
            <box flexDirection="column" padding={1}>
              <text bold>Usage — last 24h</text>
              <text />
              <text color="#888">{line(cols)}</text>
              <text color="#555">{"-".repeat(cols.reduce((a, _, i) => a + widths[i]!, 0) + (cols.length - 1) * 2)}</text>
              {snap.rows.slice(0, 20).map((r) => {
                const p = snap.pct?.[r.provider]
                return (
                  <box flexDirection="row">
                    <text width={20}>{r.provider.slice(0, 20)}</text>
                    <text width={5}>{String(r.messages).padEnd(5)}</text>
                    <text width={8}>{fmtT(r.tokensInput).padEnd(8)}</text>
                    <text width={8}>{fmtT(r.tokensOutput).padEnd(8)}</text>
                    <text width={10}>{`$${r.cost.toFixed(2)}`.padEnd(10)}</text>
                    {p ? (
                      <text>
                        <span fg={barColor(p.pct)}>{progressBar(p.pct)}</span> {p.pct.toFixed(0)}% {p.label ?? p.source}
                      </text>
                    ) : (
                      <text color="#555">—</text>
                    )}
                  </box>
                )
              })}
              <text />
              <text bold>TOTAL: {snap.totals.messages} msgs, ${snap.totals.cost.toFixed(2)} est.</text>
            </box>
          </api.ui.Dialog>
        ))
      },
    },
  ])
}

export default { id: "opencode-usage", tui } as TuiPluginModule
