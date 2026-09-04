/** @jsxImportSource @opentui/solid */
import type { TuiDialogStack, TuiPluginApi, TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { getUsageSnapshot, startOfDayMs } from "@opencode-usage/core"

const COMMAND = "opencode-usage.show"
const BAR_WIDTH = 14
const COLS = [
  { title: "PROVIDER", width: 18 },
  { title: "MSGS", width: 6 },
  { title: "TOK IN", width: 9 },
  { title: "TOK OUT", width: 9 },
  { title: "EST COST", width: 10 },
  { title: "% BUDGET", width: 26 },
] as const

type Snapshot = Awaited<ReturnType<typeof getUsageSnapshot>>

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length)
}

function progressBar(pct: number): string {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * BAR_WIDTH)
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled)
}

/**
 * Theme colors arrive as RGBA objects, and only a string is known to survive the
 * `color` prop, so every color goes through here.
 */
function toHex(color: unknown, fallback: string): string {
  if (typeof color === "string") return color
  const c = color as { r?: number; g?: number; b?: number } | undefined
  if (!c || typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number") return fallback
  const scale = c.r <= 1 && c.g <= 1 && c.b <= 1 ? 255 : 1
  const hex = (v: number) => Math.round(Math.min(Math.max(v * scale, 0), 255)).toString(16).padStart(2, "0")
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
}

interface Palette {
  text: string
  muted: string
  subtle: string
  ok: string
  warn: string
  danger: string
}

function palette(api: TuiPluginApi): Palette {
  const t = api.theme?.current as Record<string, unknown> | undefined
  return {
    text: toHex(t?.text, "#e5e5e5"),
    muted: toHex(t?.textMuted, "#8a8a8a"),
    subtle: toHex(t?.borderSubtle, "#4a4a4a"),
    ok: toHex(t?.success, "#4ade80"),
    warn: toHex(t?.warning, "#facc15"),
    danger: toHex(t?.error, "#f87171"),
  }
}

function barColor(pct: number, p: Palette): string {
  if (pct >= 90) return p.danger
  if (pct >= 70) return p.warn
  return p.ok
}

function Header(props: { palette: Palette }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text bold>Usage — today</text>
      <text color={props.palette.muted}>esc</text>
    </box>
  )
}

function Row(props: { snapshot: Snapshot; index: number; palette: Palette }) {
  const r = () => props.snapshot.rows[props.index]!
  const pct = () => props.snapshot.pct?.[r().provider]
  const cells = () => [
    pad(r().provider, COLS[0].width),
    pad(String(r().messages), COLS[1].width),
    pad(fmtTokens(r().tokensInput), COLS[2].width),
    pad(fmtTokens(r().tokensOutput), COLS[3].width),
    pad(`$${r().cost.toFixed(2)}`, COLS[4].width),
  ]
  return (
    <box flexDirection="row">
      <text color={props.palette.text}>{cells().join("  ") + "  "}</text>
      {pct() ? (
        <>
          <text color={barColor(pct()!.pct, props.palette)}>{progressBar(pct()!.pct)}</text>
          <text color={props.palette.muted}>
            {` ${pct()!.pct.toFixed(0).padStart(3)}% ${pct()!.label ?? pct()!.source}`}
          </text>
        </>
      ) : (
        <text color={props.palette.subtle}>—</text>
      )}
    </box>
  )
}

function Table(props: { api: TuiPluginApi; snapshot: Snapshot }) {
  const p = palette(props.api)
  const header = COLS.map((c) => pad(c.title, c.width)).join("  ")
  const rule = "─".repeat(COLS.reduce((a, c) => a + c.width, 0) + (COLS.length - 1) * 2)
  const rows = props.snapshot.rows.slice(0, 20)
  return (
    <box flexDirection="column">
      <Header palette={p} />
      <text />
      <text color={p.muted}>{header}</text>
      <text color={p.subtle}>{rule}</text>
      {rows.map((_, i) => (
        <Row snapshot={props.snapshot} index={i} palette={p} />
      ))}
      <text />
      <text bold>
        {`TOTAL  ${props.snapshot.totals.messages} msgs  $${props.snapshot.totals.cost.toFixed(2)} est.`}
      </text>
    </box>
  )
}

function Message(props: { api: TuiPluginApi; text: string; color?: string }) {
  const p = palette(props.api)
  return (
    <box flexDirection="column">
      <Header palette={p} />
      <text />
      <text color={props.color ?? p.muted}>{props.text}</text>
    </box>
  )
}

function fitSize(api: TuiPluginApi, dialog: TuiDialogStack): void {
  const width = (api.renderer as { width?: number } | undefined)?.width ?? 128
  dialog.setSize(width >= 128 ? "xlarge" : width >= 96 ? "large" : "medium")
}

async function show(api: TuiPluginApi, dialog: TuiDialogStack): Promise<void> {
  fitSize(api, dialog)
  dialog.replace(() => <Message api={api} text="Loading usage…" />)
  let snapshot: Snapshot
  try {
    snapshot = await getUsageSnapshot(startOfDayMs(), "provider", true)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    dialog.replace(() => <Message api={api} text={`Failed to read usage: ${message}`} color={palette(api).danger} />)
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
