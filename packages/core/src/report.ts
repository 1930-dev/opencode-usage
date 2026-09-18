import type { UsageRow, UsageTotals } from "./types.ts"
import type { ProviderStatus } from "./providers.ts"
import type { ProbeResult } from "./probe.ts"

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`
}

export function fmtAgo(ms: number, now = Date.now()): string {
  const diff = now - ms
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Formats a retry window from seconds to a size that fits a table column. */
export function fmtRetry(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.ceil(seconds / 3600)}h`
  return `${Math.ceil(seconds / 86_400)}d`
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join("  ")
  const head = line(headers)
  const sep = widths.map((w) => "-".repeat(w)).join("  ")
  const body = rows.map(line).join("\n")
  return [head, sep, body].join("\n")
}

export function usageTable(
  rows: UsageRow[],
  totals: UsageTotals,
  sinceLabel: string,
  groupBy: string,
  pct?: Map<string, { pct: number; source: string; label?: string }>,
): string {
  const headers = [groupBy.toUpperCase(), "MSGS", "TOK IN", "TOK OUT", "EST COST"]
  if (pct) headers.push("% BUDGET")
  const body = rows.slice(0, 30).map((r) => {
    const row = [
      r.group,
      String(r.messages),
      fmtTokens(r.tokensInput),
      fmtTokens(r.tokensOutput),
      fmtCost(r.cost),
    ]
    if (pct) {
      const p = pct.get(r.provider)
      if (p) row.push(`${p.pct.toFixed(1)}%${p.label ? ` ${p.label}` : ""}`)
      else row.push("—")
    }
    return row
  })
  const t = table(headers, body)
  const sourceNote = pct
    ? `\n[sources: ${[...pct.values()].map((p) => `${p.source}${p.label ? `(${p.label})` : ""}`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}]`
    : ""
  return `${t}\n\nTOTAL since ${sinceLabel}: ${totals.messages} msgs, ${fmtTokens(totals.tokensInput)} in / ${fmtTokens(totals.tokensOutput)} out, ${fmtCost(totals.cost)} est.${sourceNote}`
}

export function providersTable(statuses: ProviderStatus[], local: Map<string, { messages: number; cost: number; lastUsedMs: number }>): string {
  const headers = ["PROVIDER", "QUOTA", "USAGE 7D (LOCAL)", "LAST USED"]
  const rows = statuses.map((s) => {
    const quota = s.quota
      ? s.quota.ok
        ? s.quota.windows.map((w) => (w.detail ? `${w.label} ${w.detail}` : `${w.label} ${w.percentUsed}%`)).join(", ") || s.quota.detail || "ok"
        : `unavailable (${s.quota.detail ?? "error"})`
      : "solo-local"
    const loc = local.get(s.provider)
    const usage = loc ? `${loc.messages} msgs, ${fmtCost(loc.cost)}` : "—"
    const last = loc ? fmtAgo(loc.lastUsedMs) : "never"
    return [s.provider, quota, usage, last]
  })
  return table(headers, rows)
}

/** Renders the free-model probe results: one row per provider, what the response said. */
export function probeTable(results: ProbeResult[]): string {
  const headers = ["PROVIDER", "TAUGHT", "SIGNAL", "RETRY"]
  const rows = results.map((r) => {
    if (r.status === 0) return [r.provider, "error", r.message ?? "no signal", "—"]
    const taught = r.ok ? "yes" : "no"
    const signal = r.ok
      ? r.usage && Object.keys(r.usage).length > 0
        ? Object.entries(r.usage).map(([k, v]) => `${k}=${v}`).join(", ")
        : "http ok"
      : r.message || (r.code ? `code ${r.code}` : `HTTP ${r.status}`)
    const retry = r.retryAfterSeconds !== undefined ? fmtRetry(r.retryAfterSeconds) : "—"
    return [r.provider, taught, signal, retry]
  })
  return table(headers, rows)
}
