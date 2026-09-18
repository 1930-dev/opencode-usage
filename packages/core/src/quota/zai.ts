import { getJson, type ProviderQuota } from "./shared.ts"

interface ZaiLimit {
  name?: string
  limitType?: string
  percentage?: number
  nextResetTime?: number
}

interface ZaiResponse {
  code?: number
  msg?: string
  success?: boolean
  data?: { limits?: ZaiLimit[]; planName?: string }
}

interface ZaiWallet {
  code?: number
  msg?: string
  success?: boolean
  data?: {
    rechargeAmount?: number
    giveAmount?: number
    totalSpendAmount?: number
    todaySpendAmount?: number | null
    availableBalance?: number
    frozenBalance?: number
  }
}

export function parseZai(data: ZaiResponse): ProviderQuota {
  if (data.success === false || (data.code !== undefined && data.code !== 0)) {
    return { provider: "zai", ok: false, detail: data.msg ?? "quota endpoint error", windows: [] }
  }
  const limits = data.data?.limits ?? []
  const budget = limits.length > 0 ? { percentUsed: limits[0].percentage ?? 0, label: limits[0].name ?? limits[0].limitType ?? "limit" } : undefined
  return {
    provider: "zai",
    ok: true,
    detail: data.data?.planName,
    windows: limits.map((l) => ({
      label: l.name ?? l.limitType ?? "limit",
      percentUsed: l.percentage ?? 0,
      resetsAt: l.nextResetTime ? new Date(l.nextResetTime).toISOString() : undefined,
    })),
    budget,
    raw: data,
  }
}

export function parseZaiWallet(data: ZaiWallet): ProviderQuota {
  // The wallet answers success with code 200 (not 0); the monitor fails with
  // code 500. Accept both code flavors of success and let a failed body fail.
  const failed = data.success === false || (data.code !== undefined && data.code !== 0 && data.code !== 200)
  if (failed) {
    return { provider: "zai", ok: false, detail: data.msg ?? "wallet endpoint error", windows: [] }
  }
  const balance = data.data?.availableBalance ?? data.data?.rechargeAmount ?? 0
  const spend = data.data?.totalSpendAmount ?? 0
  const windows: ProviderQuota["windows"] = [
    { label: "balance", percentUsed: 0, detail: `$${balance.toFixed(2)}` },
    { label: "spend", percentUsed: 0, detail: `$${spend.toFixed(2)}` },
  ]
  const today = data.data?.todaySpendAmount
  if (typeof today === "number") {
    windows.push({ label: "today", percentUsed: 0, detail: `$${today.toFixed(2)}` })
  }
  return {
    provider: "zai",
    ok: true,
    detail: `balance $${balance.toFixed(2)}`,
    windows,
    raw: data,
  }
}

const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit"
const WALLET_URL = "https://api.z.ai/api/biz/account/query-customer-account-report"

export async function fetchZai(key: string): Promise<ProviderQuota> {
  try {
    const auth = { Authorization: `Bearer ${key}`, Accept: "application/json" }
    const data = (await getJson(QUOTA_URL, auth)) as ZaiResponse
    if (data.code !== undefined && data.code !== 0) {
      // The key has no GLM coding plan (the monitor replies with code 500 and
      // "当前用户不存在coding plan"); the wallet still answers with the balance
      // for a pay-as-you-go key.
      const wallet = (await getJson(WALLET_URL, auth)) as ZaiWallet
      return parseZaiWallet(wallet)
    }
    return parseZai(data)
  } catch (err) {
    return { provider: "zai", ok: false, detail: (err as Error).message, windows: [] }
  }
}
