/**
 * The command logic, with no process control: `run` throws `CliError` instead of
 * exiting, so a test drives the same code path the binary does. `cli.ts` is the
 * entry point that turns that error into an exit code.
 */
import { parseDuration, startOfDayMs, type GroupBy } from "@opencode-usage/core"
import { openDb, localUsageByProvider, getUsageSnapshot } from "@opencode-usage/core"
import { providerStatuses } from "@opencode-usage/core"
import { usageTable, providersTable, fmtCost } from "@opencode-usage/core"
import { buildTop, RANKING_ATTRIBUTION } from "@opencode-usage/core"

export const USAGE = `opencode-usage — usage tracking and model ranking for opencode

USAGE
  opencode-usage usage  [--since 7d] [--by provider|model|day|project|agent] [--today] [--pct] [--json]
  opencode-usage providers [--no-net] [--json]
  opencode-usage top [--limit 20] [--json]

OPTIONS
  --json      machine-readable output
  --no-net    skip live quota fetches (cache only)
  --today     shortcut for --since with start of today
  --since     lookback window: Nh, Nd or Nw (default 7d)
  --pct       add % BUDGET column (requires --by provider)
`

/** A message for the operator, not a crash: the entry point prints it and exits 1. */
export class CliError extends Error {}

function fail(msg: string): never {
  throw new CliError(msg)
}

const GROUP_BYS: GroupBy[] = ["provider", "model", "day", "project", "agent"]
/** Flags that take the next argument as their value when no `=` is used. */
const VALUED_FLAGS = ["--since", "--by", "--limit"]

export type Flags = Map<string, string | boolean>

export function parseArgs(argv: string[]): { cmd: string; flags: Flags } {
  const cmd = argv[0]
  if (!cmd || cmd.startsWith("-")) fail(`missing command\n\n${USAGE}`)
  const flags: Flags = new Map()
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith("--")) fail(`unexpected argument: ${a}`)
    const [key, val] = a.slice(2).split("=")
    const name = `--${key}`
    if (val !== undefined) flags.set(name, val)
    else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--") && VALUED_FLAGS.includes(name)) {
      flags.set(name, argv[++i]!)
    } else flags.set(name, true)
  }
  return { cmd, flags }
}

function stringFlag(flags: Flags, name: string): string | undefined {
  const v = flags.get(name)
  return typeof v === "string" ? v : undefined
}

function sinceMsOf(flags: Flags): number {
  if (flags.has("--today")) return startOfDayMs()
  if (!flags.has("--since")) return Date.now() - parseDuration("7d")
  const v = stringFlag(flags, "--since")
  if (v === undefined) fail("--since needs a value like 7d")
  return Date.now() - parseDuration(v)
}

export async function cmdUsage(flags: Flags, json: boolean): Promise<void> {
  const sinceMs = sinceMsOf(flags)
  const groupBy = (stringFlag(flags, "--by") ?? "provider") as GroupBy
  if (!GROUP_BYS.includes(groupBy)) fail(`invalid --by: ${groupBy}`)
  const withPct = flags.has("--pct")
  if (withPct && groupBy !== "provider") fail("--pct only supported with --by provider")

  const snapshot = await getUsageSnapshot(sinceMs, groupBy, withPct)
  if (json) {
    console.log(
      JSON.stringify(
        {
          since: new Date(sinceMs).toISOString(),
          groupBy,
          rows: snapshot.rows,
          totals: snapshot.totals,
          pct: snapshot.pct,
        },
        null,
        2,
      ),
    )
    return
  }
  const label = flags.has("--today") ? "today" : (stringFlag(flags, "--since") ?? "7d")
  const pct = snapshot.pct ? new Map(Object.entries(snapshot.pct)) : undefined
  console.log(usageTable(snapshot.rows, snapshot.totals, label, groupBy, pct))
}

export async function cmdProviders(flags: Flags, json: boolean): Promise<void> {
  const statuses = await providerStatuses({ noNet: flags.has("--no-net") })
  const db = openDb()
  try {
    const local = localUsageByProvider(db, Date.now() - parseDuration("7d"))
    if (json) console.log(JSON.stringify({ statuses, local: Object.fromEntries(local) }, null, 2))
    else console.log(providersTable(statuses, local))
  } finally {
    db.close()
  }
}

const TOP_HEADERS = ["MODEL", "NAME", "IQ", "CODING", "$/M", "IQ/$"]
const TOP_WIDTHS = [28, 26, 5, 7, 8, 6]

function topLine(cells: string[]): string {
  return cells
    .map((c, i) => (c.length >= TOP_WIDTHS[i]! ? c.slice(0, TOP_WIDTHS[i]!) : c.padEnd(TOP_WIDTHS[i]!)))
    .join("  ")
}

export async function cmdTop(flags: Flags, json: boolean): Promise<void> {
  const raw = stringFlag(flags, "--limit")
  const limit = raw !== undefined ? Number(raw) : 20
  if (!Number.isFinite(limit) || limit <= 0) fail(`invalid --limit: ${raw}`)
  const rows = await buildTop(limit)
  if (json) {
    console.log(JSON.stringify({ attribution: RANKING_ATTRIBUTION, models: rows }, null, 2))
    return
  }
  console.log(topLine(TOP_HEADERS))
  console.log(TOP_WIDTHS.map((w) => "-".repeat(w)).join("  "))
  for (const r of rows) {
    console.log(
      topLine([
        r.model,
        r.name,
        r.intelligence !== undefined ? r.intelligence.toFixed(0) : "—",
        r.codingIndex !== undefined ? r.codingIndex.toFixed(0) : "—",
        fmtCost(r.blended).replace(".00", ""),
        r.value !== undefined ? r.value.toFixed(1) : "—",
      ]),
    )
  }
  console.log(`\n${RANKING_ATTRIBUTION}`)
}

export async function run(argv: string[]): Promise<void> {
  const { cmd, flags } = parseArgs(argv)
  const json = flags.has("--json")
  if (cmd === "usage") await cmdUsage(flags, json)
  else if (cmd === "providers") await cmdProviders(flags, json)
  else if (cmd === "top") await cmdTop(flags, json)
  else fail(`unknown command: ${cmd}\n\n${USAGE}`)
}
