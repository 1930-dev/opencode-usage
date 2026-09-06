/** @jsxImportSource @opentui/solid */
import type { TuiDialogStack, TuiPluginApi, TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
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
  PADDING,
  SIZE_WIDTH,
  type Col,
  type Palette,
} from "./layout.ts"

const COMMAND = "opencode-usage.show"
/** Rows the dialog draws before it stops; a longer table would not fit anyway. */
const MAX_ROWS = 20

type Snapshot = Awaited<ReturnType<typeof getUsageSnapshot>>

export function palette(api: TuiPluginApi): Palette {
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

/**
 * The width the frame gives its content. Derived from the terminal rather than
 * read back from `dialog.size`: that getter is not reactive, so a render would
 * lay out against the size the stack had before this dialog raised it.
 */
export function terminalWidth(api: TuiPluginApi): number {
  return (api.renderer as { width?: number } | undefined)?.width ?? SIZE_WIDTH.medium
}

export function innerWidth(api: TuiPluginApi, needed: number): number {
  const terminal = terminalWidth(api)
  return Math.min(SIZE_WIDTH[chooseSize(terminal, needed)], terminal - 2) - PADDING * 2
}

/** The columns a budget label needs, over every provider that reports one. */
export function neededWidth(snapshot: Snapshot): number {
  const labels = Object.values(snapshot.pct ?? {}).map((b) => compactLabel(b.label ?? b.source).length)
  return widthNeeded(Math.max(0, ...labels))
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

export function Table(props: { api: TuiPluginApi; snapshot: Snapshot }) {
  const p = palette(props.api)
  const needed = neededWidth(props.snapshot)
  const layout = () => columnsFor(innerWidth(props.api, needed))
  return (
    <Frame api={props.api} palette={p} needed={needed}>
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

export async function show(api: TuiPluginApi, dialog: TuiDialogStack): Promise<void> {
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
