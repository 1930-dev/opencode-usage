import { openDb, usageSince, usageTotals, monthlyUsageByProvider } from "./db.ts"
import { providerStatuses } from "./providers.ts"
import { readBudgets, resolvePct } from "./budget.ts"
import { limitsAsMap } from "./limits.ts"
import { startOfMonthMs } from "./types.ts"
import type { UsageRow, UsageTotals } from "./types.ts"

export interface UsageSnapshot {
  rows: UsageRow[]
  totals: UsageTotals
  pct?: Record<string, { pct: number; source: string; label?: string }>
}

export async function getUsageSnapshot(sinceMs: number, groupBy: "provider" | "model" | "day" | "project" | "agent", includePct: boolean): Promise<UsageSnapshot> {
  const db = openDb()
  try {
    const rows = usageSince(db, sinceMs, groupBy)
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