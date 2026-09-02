#!/usr/bin/env bun
import { parseDuration, startOfDayMs, startOfMonthMs, type GroupBy } from "@opencode-usage/core"
import { openDb, usageSince, usageTotals, localUsageByProvider, getUsageSnapshot } from "@opencode-usage/core"
import { providerStatuses } from "@opencode-usage/core"
import { usageTable, providersTable, fmtCost } from "@opencode-usage/core"
import { buildTop } from "@opencode-usage/core"
import { readBudgets, resolvePct } from "@opencode-usage/core"
import { limitsAsMap } from "@opencode-usage/core"

const USAGE = `opencode-usage — usage tracking and model ranking for opencode

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

function fail(msg: string): never {
  console.error(`opencode-usage: ${msg}\n`)
  process.exit(1)
  throw new Error("unreachable")
}

function parseArgs(argv: string[]): { cmd: string; flags: Map<string, string | boolean> } {
  const cmd = argv[0]
  if (!cmd || cmd.startsWith("-")) fail(`missing command\n\n${USAGE}`)
  const flags = new Map<string, string | boolean>()
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith("--")) fail(`unexpected argument: ${a}`)
    const [key, val] = a.slice(2).split("=")
    const name = `--${key}`
    if (val !== undefined) flags.set(name, val)
    else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--") && ["--since", "--by", "--limit"].includes(name)) {
      flags.set(name, argv[++i]!)
    } else flags.set(name, true)
  }
  return { cmd, flags }
}

async function cmdUsage(flags: Map<string, string | boolean>, json: boolean): Promise<void> {
  const sinceMs = flags.has("--today")
    ? startOfDayMs()
    : flags.has("--since")
      ? (() => {
          const v = flags.get("--since")
          if (typeof v !== "string") fail("--since needs a value like 7d")
          return Date.now() - parseDuration(v)
        })()
      : Date.now() - parseDuration("7d")
  const groupBy = (typeof flags.get("--by") === "string" ? flags.get("--by") : "provider") as GroupBy
  if (!["provider", "model", "day", "project", "agent"].includes(groupBy)) fail(`invalid --by: ${groupBy}`)
  const withPct = flags.has("--pct")
  if (withPct && groupBy !== "provider") fail("--pct only supported with --by provider")

  const snapshot = await getUsageSnapshot(sinceMs, groupBy, withPct)
  if (json) {
    const out: any = {
      since: new Date(sinceMs).toISOString(),
      groupBy,
      rows: snapshot.rows,
      totals: snapshot.totals,
      pct: snapshot.pct,
    }
    console.log(JSON.stringify(out, null, 2))
  } else {
    const label = flags.has("--today")
      ? "today"
      : (flags.get("--since") as string ?? "7d")
    console.log(usageTable(snapshot.rows, snapshot.totals, label, groupBy, snapshot.pct ? new Map(Object.entries(snapshot.pct)) : undefined))
  }
}

async function cmdProviders(flags: Map<string, string | boolean>, json: boolean): Promise<void> {
  const statuses = await providerStatuses({ noNet: flags.has("--no-net") })
  const db = openDb()
  try {
    const local = localUsageByProvider(db, Date.now() - parseDuration("7d"))
    if (json) {
      console.log(JSON.stringify({ statuses, local: Object.fromEntries(local) }, null, 2))
    } else {
      console.log(providersTable(statuses, local))
    }
  } finally {
    db.close()
  }
}

async function cmdTop(flags: Map<string, string | boolean>, json: boolean): Promise<void> {
  const limit = typeof flags.get("--limit") === "string" ? Number(flags.get("--limit")) : 20
  const rows = await buildTop(limit)
  if (json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  const head = ["MODEL", "NAME", "IQ", "CODING", "$/M", "IQ/$"]
  const widths = [28, 26, 5, 7, 8, 6]
  const line = (cells: string[]) => cells.map((c, i) => c.length >= widths[i]! ? c.slice(0, widths[i]!) : c + " ".repeat(widths[i]! - c.length)).join("  ")
  console.log(line(head))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const r of rows) {
    console.log(line([
      r.model,
      r.name,
      r.intelligence !== undefined ? r.intelligence.toFixed(0) : "—",
      r.codingIndex !== undefined ? r.codingIndex.toFixed(0) : "—",
      fmtCost(r.blended).replace(".00", ""),
      r.value !== undefined ? r.value.toFixed(1) : "—",
    ]))
  }
}

if (import.meta.main) {
  const { cmd, flags } = parseArgs(process.argv.slice(2))
  const json = flags.has("--json")
  try {
    if (cmd === "usage") await cmdUsage(flags, json)
    else if (cmd === "providers") await cmdProviders(flags, json)
    else if (cmd === "top") await cmdTop(flags, json)
    else fail(`unknown command: ${cmd}\n\n${USAGE}`)
  } catch (err) {
    fail((err as Error).message)
  }
}
