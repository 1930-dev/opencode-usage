export interface ProviderLimit {
  provider: string
  metric: "tokens/day" | "tokens/minute" | "requests/day" | "credits/month" | "neurons/day"
  limit: number
  unit: string
  tier: "free" | "paid" | "unknown"
  source: string
  note?: string
}

export const PROVIDER_LIMITS: ProviderLimit[] = [
  {
    provider: "groq",
    metric: "tokens/day",
    limit: 200_000,
    unit: "tokens",
    tier: "free",
    source: "https://console.groq.com/docs/rate-limits",
    note: "Also 30k tokens/minute. Paid tiers higher.",
  },
  {
    provider: "google",
    metric: "requests/day",
    limit: 1500,
    unit: "requests",
    tier: "free",
    source: "https://ai.google.dev/gemini-api/docs/rate-limits",
    note: "Free tier: 1500 RPM, 1500 RPD. Paid tiers higher.",
  },
  {
    provider: "cloudflare-workers-ai",
    metric: "neurons/day",
    limit: 100_000,
    unit: "neurons",
    tier: "free",
    source: "https://developers.cloudflare.com/workers-ai/platform/limits/",
    note: "100k neurons/day free. Workers AI paid plans higher.",
  },
  {
    provider: "nvidia",
    metric: "credits/month",
    limit: 1000,
    unit: "credits",
    tier: "free",
    source: "https://build.nvidia.com/",
    note: "NIM free tier ~1000 credits/month. Varies by model.",
  },
  {
    provider: "digitalocean",
    metric: "tokens/day",
    limit: 5_000_000,
    unit: "tokens",
    tier: "paid",
    source: "https://docs.digitalocean.com/products/genai/",
    note: "GenAI platform paid plans. Exact limits per model.",
  },
  {
    provider: "snowflake-cortex",
    metric: "credits/month",
    limit: 100,
    unit: "credits",
    tier: "paid",
    source: "https://docs.snowflake.com/en/user-guide/snowflake-cortex",
    note: "Cortex functions consume credits. Budget per warehouse.",
  },
  {
    provider: "cerebras",
    metric: "tokens/day",
    limit: 1_000_000,
    unit: "tokens",
    tier: "free",
    source: "https://cerebras.ai/",
    note: "Free tier estimate. Paid tiers much higher.",
  },
  {
    provider: "orcarouter",
    metric: "tokens/day",
    limit: 0,
    unit: "tokens",
    tier: "unknown",
    source: "unknown",
    note: "Proxy service. No public limits documented.",
  },
]

export function getLimit(provider: string): ProviderLimit | undefined {
  return PROVIDER_LIMITS.find((l) => l.provider === provider)
}

export function limitsAsMap(): Map<string, ProviderLimit> {
  const m = new Map<string, ProviderLimit>()
  for (const l of PROVIDER_LIMITS) m.set(l.provider, l)
  return m
}