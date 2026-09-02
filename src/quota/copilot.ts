import { getJson, type ProviderQuota } from "./shared.ts"

interface CopilotSnapshot {
  percent_remaining: number
  quota_remaining: number
  unlimited: boolean
  entitlement: number
  overage_permitted: boolean
  token_based_billing?: boolean
  remaining?: number
}

interface CopilotUser {
  login: string
  copilot_plan: string
  quota_reset_date?: string
  quota_snapshots?: Record<string, CopilotSnapshot>
}

function premiumBudget(s: CopilotSnapshot): { percentUsed: number; label: string } | undefined {
  if (s.unlimited && s.entitlement === 0) return undefined
  const remaining = s.remaining ?? s.quota_remaining
  if (remaining === undefined) return undefined
  const entitlement = s.entitlement
  if (entitlement <= 0) return undefined
  const used = (entitlement - remaining) / entitlement * 100
  return { percentUsed: used, label: "premium/mo" }
}

export async function fetchCopilot(token: string): Promise<ProviderQuota> {
  try {
    const data = (await getJson("https://api.github.com/copilot_internal/user", {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "X-Github-Api-Version": "2025-04-01",
    })) as CopilotUser
    const snaps = data.quota_snapshots ?? {}
    const interesting = ["premium_interactions", "completions", "chat", "agent", "preview_features"]
    const windows = Object.entries(snaps)
      .filter(([id]) => interesting.includes(id))
      .map(([id, s]) => ({
        label: id.replace(/_/g, " "),
        percentUsed: s.unlimited && s.entitlement === 0 ? 0 : Math.round(100 - s.percent_remaining),
        resetsAt: data.quota_reset_date,
        detail: s.unlimited ? "unlimited" : `${s.quota_remaining} left of ${s.entitlement}`,
      }))
    const budget = premiumBudget(snaps.premium_interactions) ?? premiumBudget(snaps.agent) ?? undefined
    return {
      provider: "github-copilot",
      ok: true,
      detail: `plan ${data.copilot_plan}`,
      windows,
      budget,
      raw: data,
    }
  } catch (err) {
    return { provider: "github-copilot", ok: false, detail: (err as Error).message, windows: [] }
  }
}
