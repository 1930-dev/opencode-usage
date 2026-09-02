/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { getUsageSnapshot } from "../core/src/snapshot.ts"
import { fmtTokens, fmtCost } from "../core/src/report.ts"

interface ProviderRow {
  provider: string
  messages: number
  tokensInput: number
  tokensOutput: number
  cost: number
}

interface PctInfo {
  pct: number
  source: string
  label?: string
}

interface UsageSnapshot {
  rows: ProviderRow[]
  totals: { messages: number; cost: number }
  pct?: Record<string, PctInfo>
}

function progressBar(pct: number, width = 14): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * width)
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, width - filled))
}

function barColor(pct: number): string {
  if (pct >= 90) return "\x1b[31m"
  if (pct >= 70) return "\x1b[33m"
  return "\x1b[32m"
}

function UsageView({ snap }: { snap: UsageSnapshot }) {
  const headers = ["PROVIDER".padEnd(20), "MSGS".padEnd(6), "TOK IN".padEnd(8), "TOK OUT".padEnd(9), "EST COST".padEnd(10), "BUDGET".padEnd(18)]
  return (
    <box flexDirection="column" padding={1}>
      <text bold fg="#ffffff">
        Usage — last 7 days
      </text>
      <text>{""}</text>
      <text color="#888888">{headers.join("  ")}</text>
      <text color="#555555">
        {"-".repeat(
          headers.map((h) => h.length).reduce((a, b) => a + b, 0) + (headers.length - 1) * 2,
        )}
      </text>
      {snap.rows.map((row) => {
        const p = snap.pct?.[row.provider]
        return (
          <box flexDirection="row">
            <text width={20}>{row.provider.slice(0, 20)}</text>
            <text width={6}>{String(row.messages).padEnd(6)}</text>
            <text width={8}>{fmtTokens(row.tokensInput).padEnd(8)}</text>
            <text width={9}>{fmtTokens(row.tokensOutput).padEnd(9)}</text>
            <text width={10}>{fmtCost(row.cost).padEnd(10)}</text>
            {p ? (
              <text>
                <span fg={barColor(p.pct)}>{progressBar(p.pct)}</span> {p.pct.toFixed(0)}% {p.label ?? p.source}
              </text>
            ) : (
              <text color="#555555">{"—"}</text>
            )}
          </box>
        )
      })}
      <text>{""}</text>
      <text bold>
        TOTAL: {snap.totals.messages} msgs, {fmtTokens(snap.totals.messages)} in / out, {fmtCost(snap.totals.cost)} est.
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.command.register(() => [
    {
      title: "Show usage",
      value: "opencode-usage.show",
      slash: { name: "usage" },
      onSelect: async (dialog) => {
        const snap = await getUsageSnapshot(Date.now() - 7 * 24 * 60 * 60 * 1000, "provider", true)
        dialog.replace(() => (
          <api.ui.Dialog size="xlarge" onClose={() => dialog.clear()}>
            <UsageView snap={snap} />
          </api.ui.Dialog>
        ))
      },
    },
  ])
}

export default { id: "opencode-usage", tui } as TuiPluginModule