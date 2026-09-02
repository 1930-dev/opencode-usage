import { getJson, type ProviderQuota } from "./shared.ts"

interface Credits {
  data: { total_credits: number; total_usage: number }
}

interface KeyInfo {
  data: {
    label: string
    usage: number
    usage_daily: number
    usage_weekly: number
    usage_monthly: number
    limit: number | null
  }
}

export async function fetchOpenRouter(key: string): Promise<ProviderQuota> {
  try {
    const credits = (await getJson("https://openrouter.ai/api/v1/credits", {
      Authorization: `Bearer ${key}`,
    })) as Credits
    let keyInfo: KeyInfo["data"] | undefined
    try {
      keyInfo = ((await getJson("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` })) as KeyInfo).data
    } catch {
      keyInfo = undefined
    }
    const totalCredits = credits.data.total_credits
    const totalUsage = credits.data.total_usage
    const balance = totalCredits - totalUsage
    const pct = totalCredits > 0 ? (totalUsage / totalCredits) * 100 : 0
    return {
      provider: "openrouter",
      ok: true,
      detail: `balance $${balance.toFixed(2)} of $${totalCredits.toFixed(2)}`,
      windows: keyInfo
        ? [
            { label: "daily", percentUsed: 0, detail: `$${keyInfo.usage_daily.toFixed(4)}` },
            { label: "weekly", percentUsed: 0, detail: `$${keyInfo.usage_weekly.toFixed(4)}` },
            { label: "monthly", percentUsed: 0, detail: `$${keyInfo.usage_monthly.toFixed(4)}` },
          ]
        : [],
      budget: totalCredits > 0 ? { percentUsed: pct, label: "credits" } : undefined,
      raw: { credits: credits.data, key: keyInfo },
    }
  } catch (err) {
    return { provider: "openrouter", ok: false, detail: (err as Error).message, windows: [] }
  }
}
