import { readFile } from "node:fs/promises"
import { budgetsPath } from "./config.ts"
import type { ProviderQuota } from "./quota/shared.ts"
import { limitsAsMap, type ProviderLimit } from "./limits.ts"

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

function pctFromLimit(limit: ProviderLimit, usageTokens: number, usageRequests: number): number | undefined {
  if (limit.limit <= 0) return undefined
  const effectiveLimit = limit.metric.endsWith("/day") && limit.metric !== "neurons/day"
    ? limit.limit * 30
    : limit.limit
  const metric = limit.metric.replace("/day", "").replace("/month", "")
  switch (metric) {
    case "tokens":
      if (effectiveLimit > 0) return (usageTokens / effectiveLimit) * 100
      return undefined
    case "requests":
      if (effectiveLimit > 0) return (usageRequests / effectiveLimit) * 100
      return undefined
    case "credits":
    case "neurons":
      return undefined
    default:
      return undefined
  }
}

export function resolvePct(
  provider: string,
  live: Map<string, ProviderQuota>,
  budgets: Record<string, number>,
  monthCost: number,
  usageTokens: number,
  usageRequests: number,
  limits: Map<string, ProviderLimit>,
): PctResult {
  const liveQ = live.get(provider)
  if (liveQ?.budget && liveQ.ok) {
    return { pct: liveQ.budget.percentUsed, source: "live", label: liveQ.budget.label }
  }
  if (budgets[provider] !== undefined) {
    const budget = budgets[provider]
    if (budget <= 0) return { pct: 0, source: "budgets" }
    return { pct: (monthCost / budget) * 100, source: "budgets" }
  }
  const limit = limits.get(provider)
  if (limit) {
    const pct = pctFromLimit(limit, usageTokens, usageRequests)
    if (pct !== undefined) {
      return { pct, source: "limits", label: `${limit.limit.toLocaleString()} ${limit.unit}/${limit.metric.split("/")[1]}` }
    }
  }
  return { pct: 0, source: "none" }
}