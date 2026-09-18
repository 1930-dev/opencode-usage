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
    limit: 10_000,
    tier: "free",
    source: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    note: "10,000 neurons/day free, resets at 00:00 UTC. A neuron is Cloudflare's own unit, per model. Live usage needs an API token with the Analytics read scope; the Workers AI key does not carry one.",
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
    limit: 0,
    tier: "free",
    source: "https://forums.developer.nvidia.com/t/request-more-4-000-credits-option-on-build-nvidia-com/344567",
    note: "The credit allowance was retired; build.nvidia.com now rate-limits the trial per model (about 40 RPM, unpublished, shown in the UI header). No usage endpoint exists.",
  },
  {
    provider: "opencode",
    unit: "tokens",
    period: "month",
    limit: 0,
    tier: "unknown",
    source: "https://opencode.ai/docs/go/",
    note: "The opencode gateway exposes no spend API to its API key; the dashboard balance needs a browser session. Go usage is measured through the opencode-go provider instead.",
  },
  {
    provider: "orcarouter",
    unit: "tokens",
    period: "day",
    limit: 0,
    tier: "unknown",
    source: "https://docs.orcarouter.ai/operations/billing-and-usage",
    note: "Pay-per-token at upstream rates with no markup. A per-key credit cap turns into a live budget; without one there is nothing to exhaust. Free models are rate-limited with unpublished numbers.",
  },
  {
    provider: "snowflake-cortex",
    unit: "credits",
    period: "month",
    limit: 100,
    tier: "paid",
    source: "https://docs.snowflake.com/en/sql-reference/account-usage/cortex_ai_functions_usage_history",
    note: "Billed per token (Service Consumption Table). Live tokens come from ACCOUNT_USAGE.CORTEX_REST_API_USAGE_HISTORY through the SQL API with the stored JWT; the percentage needs a snowflake-cortex line in budgets.json.",
  },
  {
    provider: "zai",
    unit: "tokens",
    period: "day",
    limit: 0,
    tier: "unknown",
    source: "https://openusage.sh/docs/providers/zai/",
    note: "The quota monitor answers only keys with an active GLM coding plan; this key reports none, so the endpoint returns an error. With a plan, the monitor exposes a rolling 5h window plus weekly and monthly limits.",
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
