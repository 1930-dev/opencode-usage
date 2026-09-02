export interface QuotaWindow {
  label: string
  percentUsed: number
  resetsAt?: string
  status?: string
  detail?: string
}

export interface ProviderQuota {
  provider: string
  ok: boolean
  detail?: string
  windows: QuotaWindow[]
  raw?: unknown
}

export const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

export async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.json()
}
