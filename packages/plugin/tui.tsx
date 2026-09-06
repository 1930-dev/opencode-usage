/** @jsxImportSource @opentui/solid */
import type { TuiDialogStack, TuiPluginApi, TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { getUsageSnapshot, startOfDayMs } from "@opencode-usage/core"

const COMMAND = "opencode-usage.show"
const BAR_WIDTH = 14

/**
 * The dialog frame is about 60 columns wide at its "large" size, so the table
 * is built to 47 and the budget bar goes on its own line under each row. A
 * wider table wraps inside the frame, which is unreadable.
 */
const COLS = [
  { title: "PROVIDER", width: 13, align: "left" },
  { title: "MSGS", width: 5, align: "right" },
  { title: "TOK IN", width: 8, align: "right" },
  { title: "TOK OUT", width: 8, align: "right" },
  { title: "COST", width: 9, align: "right" },
] as const
const TABLE_WIDTH = COLS.reduce((a, c) => a + c.width, 0) + (COLS.length - 1)

type Snapshot = Awaited<ReturnType<typeof getUsageSnapshot>>

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function cell(s: string, i: number): string {
  const { width, align } = COLS[i]!
  const v = s.length > width ? s.slice(0, width) : s
  return align === "right" ? v.padStart(width) : v.padEnd(width)
}

function line(values: string[]): string {
  return values.map(cell).join(" ")
}

function progressBar(pct: number): string {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * BAR_WIDTH)
  return "\u2588".repeat(filled) + "\u2591".repeat(BAR_WIDTH - filled)
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
      <text fg={props.palette.text} bold>{"Usage \u2014 today"}</text>
      <text fg={props.palette.muted}>esc</text>
    </box>
  )
}

function Budget(props: { pct: number; label: string; palette: Palette }) {
  return (
    <box flexDirection="row">
      <text fg={props.palette.subtle}>{"  "}</text>
      <text fg={barColor(props.pct, props.palette)}>{progressBar(props.pct)}</text>
      <text fg={props.palette.muted}>{` ${props.pct.toFixed(0).padStart(3)}%  ${props.label}`}</text>
    </box>
  )
}

export function Table(props: { api: TuiPluginApi; snapshot: Snapshot }) {
  const p = palette(props.api)
  const rows = props.snapshot.rows.slice(0, 20)
  const rule = "\u2500".repeat(TABLE_WIDTH)
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <Header palette={p} />
      <text fg={p.muted} wrapMode="none">{line(COLS.map((c) => c.title))}</text>
      <text fg={p.subtle} wrapMode="none">{rule}</text>
      {rows.map((r) => {
        const budget = props.snapshot.pct?.[r.provider]
        return (
          <>
            <text fg={p.text} wrapMode="none">
              {line([
                r.provider,
                String(r.messages),
                fmtTokens(r.tokensInput),
                fmtTokens(r.tokensOutput),
                `$${r.cost.toFixed(2)}`,
              ])}
            </text>
            {budget ? <Budget pct={budget.pct} label={budget.label ?? budget.source} palette={p} /> : null}
          </>
        )
      })}
      <text fg={p.subtle} wrapMode="none">{rule}</text>
      <text fg={p.text} bold wrapMode="none">
        {line(["TOTAL", String(props.snapshot.totals.messages), "", "", `$${props.snapshot.totals.cost.toFixed(2)}`])}
      </text>
    </box>
  )
}

export function Message(props: { api: TuiPluginApi; text: string; color?: string }) {
  const p = palette(props.api)
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <Header palette={p} />
      <text />
      <text fg={props.color ?? p.muted}>{props.text}</text>
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
