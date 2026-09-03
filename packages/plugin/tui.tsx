/** @jsxImportSource @opentui/solid */
import type { TuiDialogStack, TuiPluginApi, TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { getUsageSnapshot, startOfDayMs } from "@opencode-usage/core"

const COMMAND = "opencode-usage.show"
const COLS = ["PROVIDER", "MSGS", "TOK IN", "TOK OUT", "EST COST", "% BUDGET"] as const
const WIDTHS = [18, 6, 9, 9, 10, 26] as const

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length)
}

function progressBar(pct: number, width = 14): string {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function barColor(pct: number): string {
  if (pct >= 90) return "#f87171"
  if (pct >= 70) return "#facc15"
  return "#4ade80"
}

type Snapshot = Awaited<ReturnType<typeof getUsageSnapshot>>

function Frame(props: { api: TuiPluginApi; children: any }) {
  const Dialog = props.api.ui.Dialog
  return (
    <Dialog size="xlarge" onClose={() => props.api.ui.dialog.clear()}>
      <box flexDirection="column" padding={1}>
        <text bold>Usage — today</text>
        <text />
        {props.children}
      </box>
    </Dialog>
  )
}

function Table(props: { api: TuiPluginApi; snapshot: Snapshot }) {
  const header = COLS.map((c, i) => pad(c, WIDTHS[i]!)).join("  ")
  const rule = "-".repeat(WIDTHS.reduce((a, w) => a + w, 0) + (COLS.length - 1) * 2)
  return (
    <Frame api={props.api}>
      <text color="#888">{header}</text>
      <text color="#555">{rule}</text>
      {props.snapshot.rows.slice(0, 20).map((r) => {
        const p = props.snapshot.pct?.[r.provider]
        return (
          <box flexDirection="row">
            <text>{pad(r.provider, WIDTHS[0]!)}  </text>
            <text>{pad(String(r.messages), WIDTHS[1]!)}  </text>
            <text>{pad(fmtTokens(r.tokensInput), WIDTHS[2]!)}  </text>
            <text>{pad(fmtTokens(r.tokensOutput), WIDTHS[3]!)}  </text>
            <text>{pad(`$${r.cost.toFixed(2)}`, WIDTHS[4]!)}  </text>
            {p ? (
              <text>
                <span fg={barColor(p.pct)}>{progressBar(p.pct)}</span>
                {` ${p.pct.toFixed(0).padStart(3)}% ${p.label ?? p.source}`}
              </text>
            ) : (
              <text color="#555">—</text>
            )}
          </box>
        )
      })}
      <text />
      <text bold>
        {`TOTAL: ${props.snapshot.totals.messages} msgs, $${props.snapshot.totals.cost.toFixed(2)} est.`}
      </text>
    </Frame>
  )
}

async function show(api: TuiPluginApi, dialog: TuiDialogStack): Promise<void> {
  dialog.replace(() => (
    <Frame api={api}>
      <text color="#888">Loading usage…</text>
    </Frame>
  ))
  let snapshot: Snapshot
  try {
    snapshot = await getUsageSnapshot(startOfDayMs(), "provider", true)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    dialog.replace(() => (
      <Frame api={api}>
        <text color="#f87171">Failed to read usage: {message}</text>
      </Frame>
    ))
    return
  }
  dialog.replace(() => <Table api={api} snapshot={snapshot} />)
}

export const tui: TuiPlugin = async (api) => {
  const keymap = api.keymap as unknown as {
    registerLayer?: (layer: { commands: unknown[] }) => unknown
  }
  if (typeof keymap.registerLayer === "function") {
    keymap.registerLayer({
      commands: [
        {
          namespace: "palette",
          name: COMMAND,
          title: "Usage",
          desc: "Show opencode usage and budget per provider",
          category: "Usage",
          slashName: "usage",
          run: () => show(api, api.ui.dialog),
        },
      ],
    })
    return
  }
  api.command?.register(() => [
    {
      title: "Usage",
      description: "Show opencode usage and budget per provider",
      value: COMMAND,
      category: "Usage",
      slash: { name: "usage" },
      onSelect: (dialog) => show(api, dialog ?? api.ui.dialog),
    },
  ])
}

export default { id: "opencode-usage", tui } satisfies TuiPluginModule
