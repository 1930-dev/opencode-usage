/** @jsxImportSource @opentui/solid */
import type { TuiDialogStack, TuiPluginApi, TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { getUsageSnapshot, startOfDayMs } from "@opencode-usage/core"

const COMMAND = "opencode-usage.show"

/**
 * The dialog frame gives about 61 columns at its "large" size. The table is
 * built to 57 plus one column of padding on each side; content wider than the
 * frame wraps, which is unreadable, so every column has a fixed width and every
 * row carries wrapMode="none" to clip instead.
 */
const COLS = [
  { title: "PROVIDER", width: 15, align: "left" },
  { title: "MSGS", width: 4, align: "right" },
  { title: "IN", width: 6, align: "right" },
  { title: "OUT", width: 6, align: "right" },
  { title: "COST", width: 8, align: "right" },
  { title: "BUDGET", width: 14, align: "left" },
] as const
const BUDGET_COL = COLS.length - 1
const TABLE_WIDTH = COLS.reduce((a, c) => a + c.width, 0) + (COLS.length - 1)
/** Whatever the bar and " 100%" do not use inside the budget column. */
const BAR_WIDTH = 6

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
 * The budget column has no room for a full label next to the bar and the
 * percentage, and the labels vary in kind — "weekly", "premium/mo",
 * "1,000,000 tokens/day". What the reader needs there is the window the
 * percentage is measured over, so only that is kept.
 */
function windowSuffix(label: string): string {
  const l = label.toLowerCase()
  const hours = l.match(/\b(\d+)\s*h\b/)
  if (hours) return `${hours[1]}h`
  if (/\byear|\/yr\b/.test(l)) return "yr"
  if (/\bmonth|\/mo\b/.test(l)) return "mo"
  if (/\bweek|\/wk\b/.test(l)) return "wk"
  if (/\bday|daily|\/d\b/.test(l)) return "d"
  if (/\bhour/.test(l)) return "h"
  return ""
}

function toHex(color: unknown, fallback: string): string {
  if (typeof color === "string") return color
  const c = color as { r?: number; g?: number; b?: number } | undefined
  if (!c || typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number") return fallback
  const scale = c.r <= 1 && c.g <= 1 && c.b <= 1 ? 255 : 1
  const hex = (v: number) => Math.round(Math.min(Math.max(v * scale, 0), 255)).toString(16).padStart(2, "0")
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
}

interface Palette {
  accent: string
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
    accent: toHex(t?.primary, "#a277ff"),
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

function Frame(props: { palette: Palette; children: any }) {
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <Header palette={props.palette} />
      <text />
      {props.children}
    </box>
  )
}

function Budget(props: { pct: number; label: string; palette: Palette }) {
  const suffix = () => {
    const tail = ` ${props.pct.toFixed(0).padStart(3)}% ${windowSuffix(props.label)}`
    const room = COLS[BUDGET_COL]!.width - BAR_WIDTH
    return tail.length > room ? tail.slice(0, room) : tail.padEnd(room)
  }
  return (
    <box flexDirection="row">
      <text fg={barColor(props.pct, props.palette)} wrapMode="none">{progressBar(props.pct)}</text>
      <text fg={props.palette.muted} wrapMode="none">{suffix()}</text>
    </box>
  )
}

export function Table(props: { api: TuiPluginApi; snapshot: Snapshot }) {
  const p = palette(props.api)
  const rows = props.snapshot.rows.slice(0, 20)
  const lead = (r: Snapshot["rows"][number]) =>
    line([
      r.provider,
      String(r.messages),
      fmtTokens(r.tokensInput),
      fmtTokens(r.tokensOutput),
      `$${r.cost.toFixed(2)}`,
      "",
    ]).slice(0, TABLE_WIDTH - COLS[BUDGET_COL]!.width)
  return (
    <Frame palette={p}>
      <text fg={p.accent} wrapMode="none">{line(COLS.map((c) => c.title))}</text>
      {rows.map((r) => {
        const budget = props.snapshot.pct?.[r.provider]
        return (
          <box flexDirection="row">
            <text fg={r.messages > 0 ? p.text : p.muted} wrapMode="none">{lead(r)}</text>
            {budget ? <Budget pct={budget.pct} label={budget.label ?? budget.source} palette={p} /> : null}
          </box>
        )
      })}
      <text />
      <text fg={p.text} bold wrapMode="none">
        {line(["TOTAL", String(props.snapshot.totals.messages), "", "", `$${props.snapshot.totals.cost.toFixed(2)}`, ""])}
      </text>
    </Frame>
  )
}

export function Message(props: { api: TuiPluginApi; text: string; color?: string }) {
  const p = palette(props.api)
  return (
    <Frame palette={p}>
      <text fg={props.color ?? p.muted} wrapMode="none">{props.text}</text>
    </Frame>
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
