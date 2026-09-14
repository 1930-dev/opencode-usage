import { getJson, type ProviderQuota } from "./shared.ts"

interface AmdUsage {
  status: string
  rpm_limit?: number
  daily_cost_limit_usd?: number
  daily_cost_used_usd?: number
  daily_cost_remaining_usd?: number
  daily_reset_at?: string
  today?: { requests?: number; cost?: number }
}

/**
 * AMD Radeon Cloud reports its own numbers on every key: a daily spend ceiling
 * and how much of it the account has used, in USD. The ceiling is per account
 * and read live, so it beats a budget the operator guesses. The usage endpoint
 * lives under the model-API host (`developer.amd.com.cn/radeon/api/v1`), not
 * the platform host the reference once documented.
 */
export async function fetchAmd(key: string): Promise<ProviderQuota> {
  try {
    const data = (await getJson("https://developer.amd.com.cn/radeon/api/v1/usage", {
      Authorization: `Bearer ${key}`,
    })) as AmdUsage
    if (data.status && data.status !== "ok") {
      return { provider: "amd", ok: false, detail: `usage endpoint reports ${data.status}`, windows: [] }
    }
    if (data.daily_cost_limit_usd === undefined || data.daily_cost_used_usd === undefined) {
      return { provider: "amd", ok: false, detail: "usage endpoint answered without cost fields", windows: [] }
    }
    const limit = data.daily_cost_limit_usd ?? 0
    const used = data.daily_cost_used_usd ?? 0
    const pct = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0
    const windows = [
      {
        label: "daily",
        percentUsed: pct,
        resetsAt: data.daily_reset_at,
        detail: `$${used.toFixed(4)} of $${limit.toFixed(2)}`,
      },
    ]
    return {
      provider: "amd",
      ok: true,
      windows,
      budget: limit > 0 ? { percentUsed: pct, label: `$${limit}/d` } : undefined,
      raw: data,
    }
  } catch (err) {
    return { provider: "amd", ok: false, detail: (err as Error).message, windows: [] }
  }
}