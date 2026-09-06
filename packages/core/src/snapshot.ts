import { openDb, usageSince, usageTotals, monthlyUsageByProvider } from "./db.ts"
import { providerStatuses } from "./providers.ts"
import { readBudgets, resolvePct } from "./budget.ts"
import { readAuth } from "./auth.ts"
import { limitsAsMap } from "./limits.ts"
import { startOfMonthMs } from "./types.ts"
import type { UsageRow, UsageTotals } from "./types.ts"

export interface UsageSnapshot {
  rows: UsageRow[]
  totals: UsageTotals
  pct?: Record<string, { pct: number; source: string; label?: string }>
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
  return [...rows, ...idle]
}

export async function getUsageSnapshot(sinceMs: number, groupBy: "provider" | "model" | "day" | "project" | "agent", includePct: boolean): Promise<UsageSnapshot> {
  const db = openDb()
  try {
    const rows = groupBy === "provider" ? await withConnectedProviders(usageSince(db, sinceMs, groupBy)) : usageSince(db, sinceMs, groupBy)
    const totals = usageTotals(db, sinceMs)
    let pct: Map<string, { pct: number; source: string; label?: string }> | undefined
    if (includePct) {
      const budgets = await readBudgets()
      const live = await providerStatuses({ noNet: false })
      const liveMap = new Map<string, any>()
      for (const s of live) {
        if (s.quota) liveMap.set(s.provider, s.quota)
      }
      const monthCosts = monthlyUsageByProvider(db, startOfMonthMs())
      const limits = limitsAsMap()
      const pctMap = new Map<string, { pct: number; source: string; label?: string }>()
      for (const r of rows) {
        const p = resolvePct(r.provider, liveMap, budgets, monthCosts.get(r.provider) ?? 0, r.tokensInput + r.tokensOutput, r.messages, limits)
        if (p.pct > 0 || p.source !== "none") pctMap.set(r.provider, p)
      }
      pct = pctMap
    }
    return { rows, totals, pct: pct ? Object.fromEntries(pct) : undefined }
  } finally {
    db.close()
  }
}