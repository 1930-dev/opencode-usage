/** @jsxImportSource @opentui/solid */
import type { TuiDialogStack, TuiPluginApi, TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { getUsageSnapshot, startOfDayMs } from "@opencode-usage/core"

const COMMAND = "opencode-usage.show"

/** What the host gives a dialog of each size, then clamped to the terminal. */
const SIZE_WIDTH = { medium: 60, large: 88, xlarge: 116 } as const
const PADDING = 1

type Snapshot = Awaited<ReturnType<typeof getUsageSnapshot>>
type Align = "left" | "right"
interface Col {
  title: string
  width: number
  align: Align
}

/**
 * Columns are laid out for the width the frame actually has: the wide profile
 * spells the token headers out and leaves room for the full budget label, the
 * compact one is what fits a 60-column frame. BUDGET takes whatever is left, so
 * a wider terminal buys a longer bar and a longer label rather than dead space.
 */
function columnsFor(inner: number): { cols: Col[]; bar: number } {
  const wide = inner >= 80
  const base: Col[] = wide
    ? [
        { title: "PROVIDER", width: 21, align: "left" },
        { title: "MSGS", width: 5, align: "right" },
        { title: "TOK IN", width: 8, align: "right" },
        { title: "TOK OUT", width: 8, align: "right" },
        { title: "COST", width: 9, align: "right" },
      ]
    : [
        { title: "PROVIDER", width: 15, align: "left" },
        { title: "MSGS", width: 4, align: "right" },
        { title: "IN", width: 6, align: "right" },
        { title: "OUT", width: 6, align: "right" },
        { title: "COST", width: 8, align: "right" },
      ]
  const used = base.reduce((a, c) => a + c.width, 0) + base.length
  const budget = Math.max(14, inner - used)
  return { cols: [...base, { title: "BUDGET", width: budget, align: "left" }], bar: wide ? WIDE_BAR : COMPACT_BAR }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pad(s: string, width: number, align: Align): string {
  const v = s.length > width ? s.slice(0, width) : s
  return align === "right" ? v.padStart(width) : v.padEnd(width)
}

function row(cols: Col[], values: string[]): string {
  return cols.map((c, i) => pad(values[i] ?? "", c.width, c.align)).join(" ")
}

function progressBar(pct: number, width: number): string {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

const WIDE_BAR = 12
const COMPACT_BAR = 6
/** The bar plus " 100% " that sits before the label in the budget column. */
const BUDGET_FIXED = WIDE_BAR + 6

/**
 * Documented limits arrive spelled out — "1,000,000 tokens/day". Written that
 * way the table needs a 116-column frame for one column of digits, so the
 * magnitudes are shortened and the nouns clipped.
 */
function compactLabel(label: string): string {
  return label
    .replace(/\b\d[\d,]*\b/g, (n) => {
      const v = Number(n.replace(/,/g, ""))
      if (!Number.isFinite(v)) return n
      if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
      if (v >= 1_000) return `${+(v / 1_000).toFixed(1)}K`
      return String(v)
    })
    .replace(/\btokens\b/g, "tok")
    .replace(/\brequests\b/g, "req")
}

/**
 * Budget labels vary in kind — "weekly", "premium/mo", "1,000,000 tokens/day".
 * The full label is used where it fits; where it does not, only the window the
 * percentage is measured over survives, because that is what makes the number
 * readable.
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

/**
 * Theme colors arrive as RGBA objects, and only a string is known to survive the
 * `fg` prop, so every color goes through here.
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

/**
 * The smallest frame that holds the content. Frame sizes are discrete, so a
 * table needing 80 columns in a 116-column frame is 36 columns of dead space:
 * the wide profile is built to fit `large`, and `xlarge` is only asked for when
 * an unusually long label makes it necessary. A size the terminal cannot hold
 * is clamped by the host, so asking for it buys nothing.
 */
function chooseSize(terminal: number, needed: number): keyof typeof SIZE_WIDTH {
  const held = (s: keyof typeof SIZE_WIDTH) => terminal >= SIZE_WIDTH[s] + 2
  if (held("large") && SIZE_WIDTH.large - PADDING * 2 >= needed) return "large"
  if (held("xlarge")) return "xlarge"
  if (held("large")) return "large"
  return "medium"
}

/** Columns the wide profile needs to show `label` in full. */
function widthNeeded(longestLabel: number): number {
  const { cols } = columnsFor(SIZE_WIDTH.xlarge)
  const base = cols.slice(0, -1).reduce((a, c) => a + c.width, 0) + cols.length - 1
  return base + BUDGET_FIXED + longestLabel
}

/**
 * The width the frame gives its content. Derived from the terminal rather than
 * read back from `dialog.size`: that getter is not reactive, so a render would
 * lay out against the size the stack had before this dialog raised it.
 */
function terminalWidth(api: TuiPluginApi): number {
  return (api.renderer as { width?: number } | undefined)?.width ?? SIZE_WIDTH.medium
}

function innerWidth(api: TuiPluginApi, needed: number): number {
  const terminal = terminalWidth(api)
  return Math.min(SIZE_WIDTH[chooseSize(terminal, needed)], terminal - 2) - PADDING * 2
}

function Frame(props: { api: TuiPluginApi; palette: Palette; needed: number; children: any }) {
  // The host resets the stack to "medium" and only honours setSize from inside
  // the mounted component, so this cannot move to the command handler. It runs
  // in the component body rather than onMount so the plugin needs no solid-js
  // import: that would be a second copy of solid, whose owner the host's
  // instance does not recognise, and the call would be dropped silently.
  props.api.ui.dialog.setSize(chooseSize(terminalWidth(props.api), props.needed))
  return (
    <box flexDirection="column" flexShrink={0} padding={PADDING}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.palette.text} bold>
          {"Usage — today"}
        </text>
        <text fg={props.palette.muted}>esc</text>
      </box>
      <text />
      {props.children}
    </box>
  )
}

function Budget(props: { pct: number; label: string; palette: Palette; col: Col; bar: number }) {
  const tail = () => {
    const head = ` ${props.pct.toFixed(0).padStart(3)}% `
    const room = props.col.width - props.bar - head.length
    const compact = compactLabel(props.label)
    const label = compact.length <= room ? compact : windowSuffix(props.label)
    return (head + label).slice(0, props.col.width - props.bar)
  }
  return (
    <box flexDirection="row">
      <text fg={barColor(props.pct, props.palette)} wrapMode="none">
        {progressBar(props.pct, props.bar)}
      </text>
      <text fg={props.palette.muted} wrapMode="none">
        {tail()}
      </text>
    </box>
  )
}

export function Table(props: { api: TuiPluginApi; snapshot: Snapshot }) {
  const p = palette(props.api)
  const needed = widthNeeded(
    Math.max(0, ...Object.values(props.snapshot.pct ?? {}).map((b) => compactLabel(b.label ?? b.source).length)),
  )
  const layout = () => columnsFor(innerWidth(props.api, needed))
  const lead = (cols: Col[], r: Snapshot["rows"][number]) =>
    row(cols, [
      r.provider,
      String(r.messages),
      fmtTokens(r.tokensInput),
      fmtTokens(r.tokensOutput),
      `$${r.cost.toFixed(2)}`,
    ]).trimEnd().padEnd(cols.slice(0, -1).reduce((a, c) => a + c.width, 0) + cols.length - 2) + " "
  return (
    <Frame api={props.api} palette={p} needed={needed}>
      <text fg={p.accent} wrapMode="none">
        {row(layout().cols, layout().cols.map((c) => c.title))}
      </text>
      {props.snapshot.rows.slice(0, 20).map((r) => {
        const budget = props.snapshot.pct?.[r.provider]
        return (
          <box flexDirection="row">
            <text fg={r.messages > 0 ? p.text : p.muted} wrapMode="none">
              {lead(layout().cols, r)}
            </text>
            {budget ? (
              <Budget
                pct={budget.pct}
                label={budget.label ?? budget.source}
                palette={p}
                col={layout().cols[layout().cols.length - 1]!}
                bar={layout().bar}
              />
            ) : null}
          </box>
        )
      })}
      <text />
      <text fg={p.text} bold wrapMode="none">
        {row(layout().cols, [
          "TOTAL",
          String(props.snapshot.totals.messages),
          "",
          "",
          `$${props.snapshot.totals.cost.toFixed(2)}`,
        ])}
      </text>
    </Frame>
  )
}

export function Message(props: { api: TuiPluginApi; text: string; color?: string }) {
  const p = palette(props.api)
  return (
    <Frame api={props.api} palette={p} needed={0}>
      <text fg={props.color ?? p.muted} wrapMode="none">
        {props.text}
      </text>
    </Frame>
  )
}

async function show(api: TuiPluginApi, dialog: TuiDialogStack): Promise<void> {
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
