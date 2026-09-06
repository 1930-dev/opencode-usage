/**
 * Quotas the provider publishes but does not report over an API. They are the
 * last source a percentage comes from, after the provider's own numbers and
 * after budgets.json.
 */

/**
 * What the provider counts against the limit. opencode's database records
 * tokens and requests, so a limit written in those can be measured. A credit
 * and a neuron are the provider's own unit, derived from the model and the
 * request by a rule the database does not record, so a limit written in those
 * is documented here and never turned into a percentage.
 */
export type LimitUnit = "tokens" | "requests" | "credits" | "neurons"

/** The window the limit resets on. */
export type LimitPeriod = "day" | "month"

export interface ProviderLimit {
  provider: string
  unit: LimitUnit
  period: LimitPeriod
  limit: number
  tier: "free" | "paid" | "unknown"
  source: string
  note?: string
}

export const PROVIDER_LIMITS: ProviderLimit[] = [
  {
    provider: "cerebras",
    unit: "tokens",
    period: "day",
    limit: 1_000_000,
    tier: "free",
    source: "https://cerebras.ai/",
    note: "Free tier estimate. Paid tiers much higher.",
  },
  {
    provider: "cloudflare-workers-ai",
    unit: "neurons",
    period: "day",
    limit: 100_000,
    tier: "free",
    source: "https://developers.cloudflare.com/workers-ai/platform/limits/",
    note: "A neuron is Cloudflare's own unit, per model. Not measurable from tokens.",
  },
  {
    provider: "digitalocean",
    unit: "tokens",
    period: "day",
    limit: 5_000_000,
    tier: "paid",
    source: "https://docs.digitalocean.com/products/genai/",
    note: "GenAI platform paid plans. Exact limits per model.",
  },
  {
    provider: "google",
    unit: "requests",
    period: "day",
    limit: 1500,
    tier: "free",
    source: "https://ai.google.dev/gemini-api/docs/rate-limits",
    note: "Free tier: 1500 RPM, 1500 RPD. Paid tiers higher.",
  },
  {
    provider: "groq",
    unit: "tokens",
    period: "day",
    limit: 200_000,
    tier: "free",
    source: "https://console.groq.com/docs/rate-limits",
    note: "Also 30k tokens/minute. Paid tiers higher.",
  },
  {
    provider: "nvidia",
    unit: "credits",
    period: "month",
    limit: 1000,
    tier: "free",
    source: "https://build.nvidia.com/",
    note: "NIM free tier ~1000 credits/month. A credit varies by model.",
  },
  {
    provider: "orcarouter",
    unit: "tokens",
    period: "day",
    limit: 0,
    tier: "unknown",
    source: "unknown",
    note: "Proxy service. No public limits documented.",
  },
  {
    provider: "snowflake-cortex",
    unit: "credits",
    period: "month",
    limit: 100,
    tier: "paid",
    source: "https://docs.snowflake.com/en/user-guide/snowflake-cortex",
    note: "Credits follow warehouse time, not tokens. Not measurable from usage.",
  },
]

const MEASURED_UNITS: ReadonlySet<LimitUnit> = new Set<LimitUnit>(["tokens", "requests"])

/**
 * Whether a percentage can be computed for this limit: the database has to
 * record what the limit counts, and the limit has to be a number.
 */
export function isMeasurable(limit: ProviderLimit): boolean {
  return limit.limit > 0 && MEASURED_UNITS.has(limit.unit)
}

/** The limit as the provider writes it, for the budget column. */
export function limitLabel(limit: ProviderLimit): string {
  return `${limit.limit.toLocaleString()} ${limit.unit}/${limit.period}`
}

export function getLimit(provider: string): ProviderLimit | undefined {
  return PROVIDER_LIMITS.find((l) => l.provider === provider)
}

export function limitsAsMap(): Map<string, ProviderLimit> {
  const m = new Map<string, ProviderLimit>()
  for (const l of PROVIDER_LIMITS) m.set(l.provider, l)
  return m
}
