import { getJson, type ProviderQuota } from "./shared.ts"

interface ZenUsage {
  usage: {
    rolling: { status: string; percent: number; resetsAt: string }
    weekly: { status: string; percent: number; resetsAt: string }
    monthly: { status: string; percent: number; resetsAt: string }
  }
}

export async function fetchZen(key: string): Promise<ProviderQuota> {
  try {
    const data = (await getJson("https://opencode.ai/zen/go/v1/usage", {
      Authorization: `Bearer ${key}`,
    })) as ZenUsage
    const u = data.usage
    const windows = [
      { label: "5h", percentUsed: u.rolling.percent, resetsAt: u.rolling.resetsAt, status: u.rolling.status },
      { label: "weekly", percentUsed: u.weekly.percent, resetsAt: u.weekly.resetsAt, status: u.weekly.status },
      { label: "monthly", percentUsed: u.monthly.percent, resetsAt: u.monthly.resetsAt, status: u.monthly.status },
    ]
    const binding = windows.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
    return {
      provider: "opencode-go",
      ok: true,
      windows,
      budget: { percentUsed: binding.percentUsed, label: binding.label },
      raw: data,
    }
  } catch (err) {
    return { provider: "opencode-go", ok: false, detail: (err as Error).message, windows: [] }
  }
}
