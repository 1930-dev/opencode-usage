import { readFile } from "node:fs/promises"
import { budgetsPath } from "./config.ts"
import type { ProviderQuota } from "./quota/shared.ts"
import { isMeasurable, limitLabel, type LimitPeriod, type ProviderLimit } from "./limits.ts"

export interface Budgets {
  [provider: string]: number
}

export async function readBudgets(): Promise<Record<string, number>> {
  try {
    return JSON.parse(await readFile(budgetsPath(), "utf8")) as Record<string, number>
  } catch {
    return {}
  }
}

export interface PctResult {
  pct: number
  source: "live" | "budgets" | "limits" | "none"
  label?: string
}

/** What one provider used inside one period. */
export interface PeriodUsage {
  tokens: number
  requests: number
}

export interface PctSources {
  /** Quota the provider reported for itself. */
  live: Map<string, ProviderQuota>
  /** Monthly budget in USD, per provider, from budgets.json. */
  budgets: Record<string, number>
  /** What the provider cost so far this calendar month. */
  monthCost: number
  /**
   * Usage in each period a documented limit resets on. A daily limit is read
   * against today and a monthly one against this month, so the percentage
   * answers the question the limit asks.
   */
  usage: Record<LimitPeriod, PeriodUsage>
  limits: Map<string, ProviderLimit>
}

function pctFromLimit(limit: ProviderLimit, usage: Record<LimitPeriod, PeriodUsage>): number | undefined {
  if (!isMeasurable(limit)) return undefined
  const period = usage[limit.period]
  const used = limit.unit === "requests" ? period.requests : period.tokens
  return (used / limit.limit) * 100
}

/**
 * One percentage per provider, from the best source that has an answer: the
 * provider's own numbers, then the operator's budget in USD, then a published
 * limit. A provider that none of the three can answer for reports `none`.
 */
export function resolvePct(provider: string, sources: PctSources): PctResult {
  const live = sources.live.get(provider)
  if (live?.budget && live.ok) {
    return { pct: live.budget.percentUsed, source: "live", label: live.budget.label }
  }

  const budget = sources.budgets[provider]
  if (budget !== undefined) {
    if (budget <= 0) return { pct: 0, source: "budgets" }
    return { pct: (sources.monthCost / budget) * 100, source: "budgets" }
  }

  const limit = sources.limits.get(provider)
  if (limit) {
    const pct = pctFromLimit(limit, sources.usage)
    if (pct !== undefined) return { pct, source: "limits", label: limitLabel(limit) }
  }

  return { pct: 0, source: "none" }
}
