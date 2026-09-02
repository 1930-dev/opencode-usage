export type GroupBy = "provider" | "model" | "day" | "project" | "agent"

export interface UsageRow {
  group: string
  provider: string
  model: string
  day: string
  project: string
  agent: string
  messages: number
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
}

export interface UsageTotals {
  messages: number
  cost: number
  tokensInput: number
  tokensOutput: number
}

export function parseDuration(input: string): number {
  const m = /^(\d+)\s*(h|d|w)$/.exec(input.trim().toLowerCase())
  if (!m) throw new Error(`invalid duration: ${input} (use Nh, Nd or Nw)`)
  const n = Number(m[1])
  const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2] as "h" | "d" | "w"]
  return n * ms
}

export function startOfDayMs(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
