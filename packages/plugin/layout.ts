/**
 * Text layout for the /usage dialog: column widths, padding, the progress bar
 * and the budget labels. Everything here is pure — it takes numbers and strings
 * and returns strings — so the table can be reasoned about and tested without a
 * terminal. tui.tsx holds the parts that need the host.
 */

/** What the host gives a dialog of each size, then clamped to the terminal. */
export const SIZE_WIDTH = { medium: 60, large: 88, xlarge: 116 } as const
export const PADDING = 1

export type SizeName = keyof typeof SIZE_WIDTH
export type Align = "left" | "right"

export interface Col {
  title: string
  width: number
  align: Align
}

export const WIDE_BAR = 12
export const COMPACT_BAR = 6
/** The bar plus " 100% " that sits before the label in the budget column. */
export const BUDGET_FIXED = WIDE_BAR + 6

/** Below this the compact column profile is used. */
const WIDE_MIN = 80
const BUDGET_MIN = 14

/**
 * Columns are laid out for the width the frame actually has: the wide profile
 * spells the token headers out and leaves room for the full budget label, the
 * compact one is what fits a 60-column frame. BUDGET takes whatever is left, so
 * a wider terminal buys a longer bar and a longer label rather than dead space.
 */
export function columnsFor(inner: number): { cols: Col[]; bar: number } {
  const wide = inner >= WIDE_MIN
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
  const budget = Math.max(BUDGET_MIN, inner - used)
  return { cols: [...base, { title: "BUDGET", width: budget, align: "left" }], bar: wide ? WIDE_BAR : COMPACT_BAR }
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function pad(s: string, width: number, align: Align): string {
  const v = s.length > width ? s.slice(0, width) : s
  return align === "right" ? v.padStart(width) : v.padEnd(width)
}

export function row(cols: Col[], values: string[]): string {
  return cols.map((c, i) => pad(values[i] ?? "", c.width, c.align)).join(" ")
}

export function progressBar(pct: number, width: number): string {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

/**
 * Documented limits arrive spelled out — "1,000,000 tokens/day". Written that
 * way the table needs a 116-column frame for one column of digits, so the
 * magnitudes are shortened and the nouns clipped.
 */
export function compactLabel(label: string): string {
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
export function windowSuffix(label: string): string {
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

/** The budget cell after the bar: the percentage, then as much label as fits. */
export function budgetTail(pct: number, label: string, colWidth: number, bar: number): string {
  const head = ` ${pct.toFixed(0).padStart(3)}% `
  const room = colWidth - bar - head.length
  const compact = compactLabel(label)
  const text = compact.length <= room ? compact : windowSuffix(label)
  return (head + text).slice(0, colWidth - bar)
}

/**
 * Theme colors arrive as RGBA objects, and only a string is known to survive the
 * `fg` prop, so every color goes through here.
 */
export function toHex(color: unknown, fallback: string): string {
  if (typeof color === "string") return color
  const c = color as { r?: number; g?: number; b?: number } | undefined
  if (!c || typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number") return fallback
  const scale = c.r <= 1 && c.g <= 1 && c.b <= 1 ? 255 : 1
  const hex = (v: number) => Math.round(Math.min(Math.max(v * scale, 0), 255)).toString(16).padStart(2, "0")
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
}

export interface Palette {
  accent: string
  text: string
  muted: string
  subtle: string
  ok: string
  warn: string
  danger: string
}

const DANGER_PCT = 90
const WARN_PCT = 70

export function barColor(pct: number, p: Palette): string {
  if (pct >= DANGER_PCT) return p.danger
  if (pct >= WARN_PCT) return p.warn
  return p.ok
}

/**
 * The smallest frame that holds the content. Frame sizes are discrete, so a
 * table needing 80 columns in a 116-column frame is 36 columns of dead space:
 * the wide profile is built to fit `large`, and `xlarge` is only asked for when
 * an unusually long label makes it necessary. A size the terminal cannot hold
 * is clamped by the host, so asking for it buys nothing.
 */
export function chooseSize(terminal: number, needed: number): SizeName {
  const held = (s: SizeName) => terminal >= SIZE_WIDTH[s] + 2
  if (held("large") && SIZE_WIDTH.large - PADDING * 2 >= needed) return "large"
  if (held("xlarge")) return "xlarge"
  if (held("large")) return "large"
  return "medium"
}

/** Columns the wide profile needs to show `label` in full. */
export function widthNeeded(longestLabel: number): number {
  const { cols } = columnsFor(SIZE_WIDTH.xlarge)
  const base = cols.slice(0, -1).reduce((a, c) => a + c.width, 0) + cols.length - 1
  return base + BUDGET_FIXED + longestLabel
}
