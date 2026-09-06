import { openDb, usageSince, usageTotals, localUsageByProvider, type ProviderLocal } from "./db.ts"
import { providerStatuses } from "./providers.ts"
import { readBudgets, resolvePct, type PctResult, type PeriodUsage } from "./budget.ts"
import { readAuth } from "./auth.ts"
import { limitsAsMap } from "./limits.ts"
import { startOfDayMs, startOfMonthMs } from "./types.ts"
import type { GroupBy, UsageRow, UsageTotals } from "./types.ts"
import type { ProviderQuota } from "./quota/shared.ts"

export interface UsageSnapshot {
  rows: UsageRow[]
  totals: UsageTotals
  pct?: Record<string, PctResult>
}

/**
 * A provider with no traffic in the window has no row in the database, but it is
 * still connected and still has a budget worth seeing. Every provider in
 * opencode's auth store gets a row; the ones with traffic keep their order (cost
 * descending), the idle ones follow alphabetically. Reads auth.json only — no
 * network.
 */
async function withConnectedProviders(rows: UsageRow[]): Promise<UsageRow[]> {
  let connected: string[]
  try {
    connected = Object.keys(await readAuth())
  } catch {
    return rows
  }
  const seen = new Set(rows.map((r) => r.provider))
  const idle = connected
    .filter((provider) => !seen.has(provider))
    .sort()
    .map((provider) => ({
      group: provider,
      provider,
      model: "",
      day: "",
      project: "",
      agent: "",
      messages: 0,
      cost: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tokensReasoning: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
    }))
  // Used providers first, by what they cost and then by traffic; everything
  // that ties — every idle provider included — falls back to the name.
  return [...rows, ...idle].sort(
    (a, b) => b.cost - a.cost || b.messages - a.messages || a.provider.localeCompare(b.provider),
  )
}

function periodUsage(usage: Map<string, ProviderLocal>, provider: string): PeriodUsage {
  const local = usage.get(provider)
  return { tokens: local?.tokens ?? 0, requests: local?.messages ?? 0 }
}

/**
 * A percentage per provider. The window the operator asked for sizes the table,
 * but never the budget: a limit is read against the period it resets on, and a
 * budget in USD against the calendar month it is written for.
 */
async function resolvePctByProvider(rows: UsageRow[], day: Map<string, ProviderLocal>, month: Map<string, ProviderLocal>): Promise<Record<string, PctResult>> {
  const budgets = await readBudgets()
  const live = new Map<string, ProviderQuota>()
  for (const status of await providerStatuses({ noNet: false })) {
    if (status.quota) live.set(status.provider, status.quota)
  }
  const limits = limitsAsMap()

  const pct: Record<string, PctResult> = {}
  for (const row of rows) {
    const resolved = resolvePct(row.provider, {
      live,
      budgets,
      monthCost: month.get(row.provider)?.cost ?? 0,
      usage: { day: periodUsage(day, row.provider), month: periodUsage(month, row.provider) },
      limits,
    })
    if (resolved.pct > 0 || resolved.source !== "none") pct[row.provider] = resolved
  }
  return pct
}

export async function getUsageSnapshot(sinceMs: number, groupBy: GroupBy, includePct: boolean): Promise<UsageSnapshot> {
  const db = openDb()
  try {
    const grouped = usageSince(db, sinceMs, groupBy)
    const rows = groupBy === "provider" ? await withConnectedProviders(grouped) : grouped
    const totals = usageTotals(db, sinceMs)
    if (!includePct) return { rows, totals }
    const day = localUsageByProvider(db, startOfDayMs())
    const month = localUsageByProvider(db, startOfMonthMs())
    return { rows, totals, pct: await resolvePctByProvider(rows, day, month) }
  } finally {
    db.close()
  }
}
