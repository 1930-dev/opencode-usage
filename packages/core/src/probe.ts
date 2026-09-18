import { readAuth, authSecret, type AuthEntry } from "./auth.ts"

/** What a free-model probe against a provider revealed. */
export interface ProbeResult {
  provider: string
  /** HTTP status; 0 means the request never completed. */
  status: number
  /** A 2xx answer, or the transport failing inside a known provider. */
  ok: boolean
  code?: string
  message?: string
  retryAfterSeconds?: number
  usage?: Record<string, number>
}

interface ChatProbe {
  name: string
  url: string
  body: string
  extractUsage?: (parsed: unknown) => Record<string, number> | undefined
}

/** Picks out the scalar number fields, so nested objects never leak into the table. */
function numericUsage(u: unknown): Record<string, number> | undefined {
  if (typeof u !== "object" || u === null) return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(u)) {
    if (typeof v === "number") out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function redact(text: string, key: string): string {
  return key.length > 6 ? text.split(key).join("[redacted]") : text
}

const chatBody = (model: string): string =>
  JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 4 })

async function probeChat(p: ChatProbe, key: string): Promise<ProbeResult> {
  let res: Response
  try {
    res = await fetch(p.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: p.body,
    })
  } catch (err) {
    return { provider: p.name, status: 0, ok: false, message: redact((err as Error).message, key) }
  }
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  const obj = (parsed ?? {}) as {
    error?: { code?: string; message?: string; detail?: string; metadata?: { retry_after_seconds?: number } }
    errors?: { code?: string; message?: string }[]
    usage?: Record<string, unknown>
    result?: { usage?: Record<string, unknown> }
  }
  const err = obj.error
  const firstErr = Array.isArray(obj.errors) ? obj.errors[0] : undefined
  const message = redact(err?.message ?? err?.detail ?? firstErr?.message ?? "", key)
  const rawRetry = res.headers.get("retry-after")
  const headerRetry = rawRetry !== null && rawRetry !== "" ? Number(rawRetry) : Number.NaN
  const retry = Number.isFinite(headerRetry) ? headerRetry : err?.metadata?.retry_after_seconds
  const usage = p.extractUsage ? p.extractUsage(obj) : numericUsage(obj.usage)
  return {
    provider: p.name,
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    ...(err?.code ?? firstErr?.code ? { code: err?.code ?? firstErr?.code } : {}),
    ...(message ? { message } : {}),
    ...(Number.isFinite(retry) ? { retryAfterSeconds: retry } : {}),
    ...(usage ? { usage } : {}),
  }
}

type Prober = (key: string, meta?: Record<string, unknown>) => Promise<ProbeResult>

const PROBERS: Record<string, Prober> = {
  zai: (key) =>
    probeChat({ name: "zai", url: "https://api.z.ai/api/paas/v4/chat/completions", body: chatBody("glm-4.5-air") }, key),
  nvidia: (key) =>
    probeChat(
      { name: "nvidia", url: "https://integrate.api.nvidia.com/v1/chat/completions", body: chatBody("meta/llama-3.2-11b-vision-instruct") },
      key,
    ),
  orcarouter: (key) =>
    probeChat(
      { name: "orcarouter", url: "https://api.orcarouter.ai/v1/chat/completions", body: chatBody("orcarouter/free") },
      key,
    ),
  "cloudflare-workers-ai": (key, meta) => {
    const account = String(meta?.accountId ?? "")
    if (!account) {
      return Promise.resolve({ provider: "cloudflare-workers-ai", status: 0, ok: false, message: "metadata.accountId is required" })
    }
    return probeChat(
      {
        name: "cloudflare-workers-ai",
        url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/meta/llama-3.1-8b-fast-v2`,
        body: JSON.stringify({ prompt: "ping", max_tokens: 4 }),
        extractUsage: (parsed) =>
          numericUsage(
            typeof parsed === "object" && parsed !== null && "result" in parsed
              ? (parsed as { result: { usage?: Record<string, unknown> } }).result.usage
              : undefined,
          ),
      },
      key,
    )
  },
}

/**
 * Probes every connected provider that has a free-model probe. All other
 * connected providers are skipped: `opencode` exposes no spend API for keys,
 * and `snowflake-cortex` is read through its SQL quota instead.
 */
export async function runProbes(): Promise<ProbeResult[]> {
  const auth: Record<string, AuthEntry> = await readAuth()
  const results = await Promise.all(
    Object.entries(auth)
      .sort()
      .map(async ([name, entry]) => {
        const prober = PROBERS[name]
        const key = authSecret(entry)
        if (!prober || !key) return null
        return prober(key, entry.metadata)
      }),
  )
  return results.filter((r): r is ProbeResult => r !== null)
}