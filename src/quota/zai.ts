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

export function parseZai(data: ZaiResponse): ProviderQuota {
  if (data.success === false || (data.code !== undefined && data.code !== 0)) {
    return { provider: "zai", ok: false, detail: data.msg ?? "quota endpoint error", windows: [] }
  }
  const limits = data.data?.limits ?? []
  return {
    provider: "zai",
    ok: true,
    detail: data.data?.planName,
    windows: limits.map((l) => ({
      label: l.name ?? l.limitType ?? "limit",
      percentUsed: l.percentage ?? 0,
      resetsAt: l.nextResetTime ? new Date(l.nextResetTime).toISOString() : undefined,
    })),
    raw: data,
  }
}

export async function fetchZai(key: string): Promise<ProviderQuota> {
  try {
    const data = (await getJson("https://api.z.ai/api/monitor/usage/quota/limit", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    })) as ZaiResponse
    return parseZai(data)
  } catch (err) {
    return { provider: "zai", ok: false, detail: (err as Error).message, windows: [] }
  }
}
