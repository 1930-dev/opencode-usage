/** @jsxImportSource @opentui/solid */
import { Plugin, type Context } from "@opencode/plugin/tui"
import { getUsageSnapshot, startOfDayMs } from "@opencode-usage/core"
import {
  barColor,
  budgetTail,
  chooseSize,
  columnsFor,
  compactLabel,
  fmtTokens,
  progressBar,
  row,
  toHex,
  widthNeeded,
  PADDING_X,
  PADDING_Y,
  SIZE_WIDTH,
  type Col,
  type Palette,
} from "./layout.ts"

const COMMAND = "opencode-usage.usage"
/** Rows the dialog draws before it stops; a longer table would not fit anyway. */
const MAX_ROWS = 20

type Snapshot = Awaited<ReturnType<typeof getUsageSnapshot>>

/** The theme tokens this plugin reads. Every level is optional: a host that has not resolved them yet still has to render. */
interface ResolvedThemeLike {
  text?: {
    base?: unknown
    muted?: unknown
    action?: { primary?: { base?: unknown } }
    feedback?: {
      success?: { base?: unknown }
      warning?: { base?: unknown }
      error?: { base?: unknown }
    }
  }
}

/**
 * OpenCode resolves its semantic tokens to an RGBA, which is what the `fg` prop
 * takes. Every read is optional so a host that has not resolved the theme yet
 * falls back to this plugin's own colors instead of throwing inside a render.
 */
export function palette(context: Context): Palette {
  const t = context.theme as ResolvedThemeLike | undefined
  const text = t?.text
  return {
    accent: toHex(text?.action?.primary?.base, "#a277ff"),
    text: toHex(text?.base, "#e5e5e5"),
    muted: toHex(text?.muted, "#8a8a8a"),
    ok: toHex(text?.feedback?.success?.base, "#4ade80"),
    warn: toHex(text?.feedback?.warning?.base, "#facc15"),
    danger: toHex(text?.feedback?.error?.base, "#f87171"),
  }
}

/**
 * The width the frame gives its content. Derived from the terminal rather than
 * read back from the dialog size: the size getter is not reactive, so a render
 * would lay out against the size the host had before this dialog raised it.
 */
export function terminalWidth(context: Context): number {
  return (context.renderer as { width?: number } | undefined)?.width || SIZE_WIDTH.medium
}

export function innerWidth(context: Context, needed: number): number {
  const terminal = terminalWidth(context)
  return Math.min(SIZE_WIDTH[chooseSize(terminal, needed)], terminal - 2) - PADDING_X * 2
}

/** The columns a budget label needs, over every provider that reports one. */
export function neededWidth(snapshot: Snapshot): number {
  const labels = Object.values(snapshot.pct ?? {}).map((b) => compactLabel(b.label ?? b.source).length)
  return widthNeeded(Math.max(0, ...labels))
}

function Frame(props: { context: Context; palette: Palette; needed: number; children: any }) {
  // The host resets the dialog to "medium" and only honours set from inside the
  // mounted component, so this cannot move to the setup function. It runs in the
  // component body rather than onMount so the plugin needs no solid-js import:
  // that would be a second copy of solid, whose owner the host's instance does
  // not recognise, and the call would be dropped silently.
  props.context.ui.dialog.set({ size: chooseSize(terminalWidth(props.context), props.needed) })
  return (
    <box flexDirection="column" flexShrink={0} paddingX={PADDING_X} paddingY={PADDING_Y}>
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
  return (
    <box flexDirection="row">
      <text fg={barColor(props.pct, props.palette)} wrapMode="none">
        {progressBar(props.pct, props.bar)}
      </text>
      <text fg={props.palette.muted} wrapMode="none">
        {budgetTail(props.pct, props.label, props.col.width, props.bar)}
      </text>
    </box>
  )
}

/** The row up to the budget column, padded so every bar starts at one column. */
function leadCells(cols: Col[], r: Snapshot["rows"][number]): string {
  const upToBudget = cols.slice(0, -1).reduce((a, c) => a + c.width, 0) + cols.length - 2
  return (
    row(cols, [
      r.provider,
      String(r.messages),
      fmtTokens(r.tokensInput),
      fmtTokens(r.tokensOutput),
      `$${r.cost.toFixed(2)}`,
    ])
      .trimEnd()
      .padEnd(upToBudget) + " "
  )
}

export function Table(props: { context: Context; snapshot: Snapshot }) {
  const p = palette(props.context)
  const needed = neededWidth(props.snapshot)
  const layout = () => columnsFor(innerWidth(props.context, needed))
  return (
    <Frame context={props.context} palette={p} needed={needed}>
      <text fg={p.accent} wrapMode="none">
        {row(layout().cols, layout().cols.map((c) => c.title))}
      </text>
      {props.snapshot.rows.slice(0, MAX_ROWS).map((r) => {
        const budget = props.snapshot.pct?.[r.provider]
        return (
          <box flexDirection="row">
            <text fg={r.messages > 0 ? p.text : p.muted} wrapMode="none">
              {leadCells(layout().cols, r)}
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

export function Message(props: { context: Context; text: string; color?: string }) {
  const p = palette(props.context)
  return (
    <Frame context={props.context} palette={p} needed={0}>
      <text fg={props.color ?? p.muted} wrapMode="none">
        {props.text}
      </text>
    </Frame>
  )
}

export async function show(context: Context): Promise<void> {
  context.ui.dialog.show(() => <Message context={context} text="Loading usage…" />)
  let snapshot: Snapshot
  try {
    snapshot = await getUsageSnapshot(startOfDayMs(), "provider", true)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    context.ui.dialog.show(() => (
      <Message context={context} text={`Failed to read usage: ${message}`} color={palette(context).danger} />
    ))
    return
  }
  context.ui.dialog.show(() => <Table context={context} snapshot={snapshot} />)
}

export default Plugin.define({
  id: "opencode-usage",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: COMMAND,
          title: "Usage",
          description: "Show opencode usage and budget per provider",
          group: "Usage",
          palette: true,
          slash: { name: "usage" },
          run: () => show(context),
        },
      ],
    }))
  },
}) satisfies Plugin.Definition