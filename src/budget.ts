import { readFile } from "node:fs/promises"
import { budgetsPath } from "./config.ts"
import type { ProviderQuota } from "./quota/shared.ts"

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
  source: "live" | "budgets" | "none"
  label?: string
}

export function resolvePct(
  provider: string,
  live: Map<string, ProviderQuota>,
  budgets: Record<string, number>,
  monthCost: number,
): { pct: number; source: "live" | "budgets" | "none"; label?: string } {
  const liveQ = live.get(provider)
  if (liveQ?.budget && liveQ.ok) {
    return { pct: liveQ.budget.percentUsed, source: "live", label: liveQ.budget.label }
  }
  if (budgets[provider] !== undefined) {
    const budget = budgets[provider]
    if (budget <= 0) return { pct: 0, source: "budgets" }
    return { pct: (monthCost / budget) * 100, source: "budgets" }
  }
  return { pct: 0, source: "none" }
}