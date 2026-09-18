import type { ProviderQuota } from "./shared.ts"

const SQL_API = (account: string) => `https://${account}.snowflakecomputing.com/api/v2/statements`

/**
 * Cortex REST usage in the account usage views. opencode calls the full REST
 * API, which is the integration that records here: the legacy
 * CORTEX_AI_FUNCTIONS_USAGE_HISTORY view (which the limits entry cites) stays
 * empty for this path, so the live numbers come from the REST usage view.
 */
const STATEMENT = `SELECT
  SUM(CASE WHEN START_TIME >= DATE_TRUNC('day', CURRENT_TIMESTAMP())
      AND START_TIME < DATEADD('day', 1, DATE_TRUNC('day', CURRENT_TIMESTAMP()))
      THEN TOKENS ELSE 0 END) AS today_tokens,
  SUM(TOKENS) AS month_tokens
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_REST_API_USAGE_HISTORY
WHERE START_TIME >= DATEADD('day', -30, CURRENT_TIMESTAMP())`

const fmtTokens = (n: number): string => n.toLocaleString("en-US")

export function parseSnowflake(row: unknown[] | undefined): ProviderQuota {
  const today = Number(row?.[0] ?? 0)
  const month = Number(row?.[1] ?? 0)
  return {
    provider: "snowflake-cortex",
    ok: true,
    detail: `${fmtTokens(month)} tokens/30d`,
    windows: [
      { label: "tokens/mo", percentUsed: 0, detail: `${fmtTokens(month)}` },
      { label: "today", percentUsed: 0, detail: `${fmtTokens(today)}` },
    ],
    raw: { row },
  }
}

export async function fetchSnowflake(key: string, metadata?: Record<string, unknown>): Promise<ProviderQuota> {
  const account = String(metadata?.account ?? "").toUpperCase()
  if (!account) {
    return { provider: "snowflake-cortex", ok: false, detail: "metadata.account is required", windows: [] }
  }
  try {
    const res = await fetch(SQL_API(account), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ statement: STATEMENT, timeout: 30 }),
    })
    const body = (await res.json().catch(() => null)) as { data?: unknown; message?: string } | null
    if (!res.ok) {
      return { provider: "snowflake-cortex", ok: false, detail: body?.message ?? `HTTP ${res.status}`, windows: [] }
    }
    const rows = Array.isArray(body?.data) ? (body.data as unknown[][]) : []
    return parseSnowflake(rows[0])
  } catch (err) {
    return { provider: "snowflake-cortex", ok: false, detail: (err as Error).message, windows: [] }
  }
}