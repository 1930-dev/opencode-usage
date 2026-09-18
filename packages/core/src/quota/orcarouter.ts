import { getJson, type ProviderQuota } from "./shared.ts"

interface OrcaUsage {
  object?: string
  total_usage?: number
}

interface OrcaSubscription {
  object?: string
  has_payment_method?: boolean
  soft_limit_usd?: number
  hard_limit_usd?: number
  system_hard_limit_usd?: number
  access_until?: number
}

/** The billing endpoints answer in cents, the way the OpenAI ones do. */
const CENTS_PER_USD = 100
/**
 * A limit this large is the pay-as-you-go sentinel, not a ceiling the operator
 * can exhaust: OrcaRouter mints keys with no cap, and a capped key reports the
 * dollars it was granted instead.
 */
const NO_CAP = 1_000_000

export function parseOrcaRouter(usage: OrcaUsage, subscription: OrcaSubscription): ProviderQuota {
  const spent = (usage.total_usage ?? 0) / CENTS_PER_USD
  const hard = subscription.hard_limit_usd ?? 0
  const soft = subscription.soft_limit_usd ?? 0
  const cap = hard > 0 && hard < NO_CAP ? hard : soft > 0 && soft < NO_CAP ? soft : 0
  const capped = cap > 0
  const pct = capped ? (spent / cap) * 100 : 0
  return {
    provider: "orcarouter",
    ok: true,
    detail: `$${spent.toFixed(2)} spent`,
    windows: [{ label: "spend", percentUsed: pct, detail: `$${spent.toFixed(2)}` }],
    budget: capped ? { percentUsed: pct, label: `$${cap}` } : undefined,
    raw: { usage, subscription },
  }
}

export async function fetchOrcaRouter(key: string): Promise<ProviderQuota> {
  try {
    const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" }
    const usage = (await getJson("https://api.orcarouter.ai/v1/dashboard/billing/usage", headers)) as OrcaUsage
    const subscription = (await getJson("https://api.orcarouter.ai/v1/dashboard/billing/subscription", headers)) as OrcaSubscription
    return parseOrcaRouter(usage, subscription)
  } catch (err) {
    return { provider: "orcarouter", ok: false, detail: (err as Error).message, windows: [] }
  }
}