#!/usr/bin/env bun
import { parseDuration, startOfDayMs, startOfMonthMs, type GroupBy } from "./types.ts"
import { openDb, usageSince, usageTotals, localUsageByProvider, monthlyUsageByProvider } from "./db.ts"
import { providerStatuses } from "./providers.ts"
import { usageTable, providersTable, fmtCost } from "./report.ts"
import { buildTop } from "./top.ts"
import { readBudgets, resolvePct } from "./budget.ts"

const USAGE = `opencode-imp — usage tracking and model ranking for opencode

USAGE
  opencode-imp usage  [--since 7d] [--by provider|model|day|project|agent] [--today] [--pct] [--json]
  opencode-imp providers [--no-net] [--json]
  opencode-imp top [--limit 20] [--json]

OPTIONS
  --json      machine-readable output
  --no-net    skip live quota fetches (cache only)
  --today     shortcut for --since with start of today
  --since     lookback window: Nh, Nd or Nw (default 7d)
  --pct       add % BUDGET column (requires --by provider)
`

function fail(msg: string): never {
  console.error(`opencode-imp: ${msg}\n`)
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

  const db = openDb()
  try {
    const rows = usageSince(db, sinceMs, groupBy)
    const totals = usageTotals(db, sinceMs)
    let pct: Map<string, { pct: number; source: string; label?: string }> | undefined
    if (withPct) {
      const budgets = await readBudgets()
      const live = await providerStatuses({ noNet: flags.has("--no-net") })
      const liveMap = new Map(live.map((s) => [s.provider, s.quota] as [string, any]))
      const monthCosts = monthlyUsageByProvider(db, startOfMonthMs())
      const pctMap = new Map<string, { pct: number; source: string; label?: string }>()
      for (const r of rows) {
        const p = resolvePct(r.provider, liveMap, await readBudgets(), monthCosts.get(r.provider) ?? 0)
        if (p.pct > 0 || p.source !== "none") pctMap.set(r.provider, p)
      }
      pct = pctMap
    }
    if (json) {
      const out: any = { since: new Date(sinceMs).toISOString(), groupBy, rows, totals }
      if (withPct) out.pct = Object.fromEntries(pct!)
      console.log(JSON.stringify(out, null, 2))
    } else {
      const label = flags.has("--today")
        ? "today"
        : (flags.get("--since") as string ?? "7d")
      console.log(usageTable(rows, totals, label, groupBy, withPct ? pct : undefined))
    }
  } finally {
    db.close()
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
