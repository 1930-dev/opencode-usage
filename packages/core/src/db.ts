import { Database } from "bun:sqlite"
import { dbPath } from "./config.ts"
import type { GroupBy, UsageRow, UsageTotals } from "./types.ts"

export function openDb(): Database {
  const db = new Database(dbPath(), { readonly: true })
  db.exec("PRAGMA query_only = true")
  return db
}

const COST = "CAST(json_extract(data,'$.cost') AS REAL)"
const T_IN = "CAST(json_extract(data,'$.tokens.input') AS INTEGER)"
const T_OUT = "CAST(json_extract(data,'$.tokens.output') AS INTEGER)"
const T_REA = "CAST(json_extract(data,'$.tokens.reasoning') AS INTEGER)"
const T_CR = "CAST(json_extract(data,'$.tokens.cache.read') AS INTEGER)"
const T_CW = "CAST(json_extract(data,'$.tokens.cache.write') AS INTEGER)"
const CREATED = "CAST(json_extract(data,'$.time.created') AS INTEGER)"

const GROUPS: Record<GroupBy, string> = {
  provider: "json_extract(data,'$.providerID')",
  model: "json_extract(data,'$.providerID') || '/' || json_extract(data,'$.modelID')",
  day: `strftime('%Y-%m-%d', (${CREATED})/1000, 'unixepoch')`,
  project: "json_extract(data,'$.path.cwd')",
  agent: "json_extract(data,'$.agent')",
}

export function usageSince(db: Database, sinceMs: number, groupBy: GroupBy = "provider"): UsageRow[] {
  const g = GROUPS[groupBy]
  const rows = db
    .query<Record<string, unknown>, [number]>(
      `SELECT ${g} AS grp,
              COALESCE(json_extract(data,'$.providerID'),'?') AS provider,
              COALESCE(json_extract(data,'$.modelID'),'?') AS model,
              COUNT(*) AS messages,
              COALESCE(SUM(${COST}),0) AS cost,
              COALESCE(SUM(${T_IN}),0) AS tokensInput,
              COALESCE(SUM(${T_OUT}),0) AS tokensOutput,
              COALESCE(SUM(${T_REA}),0) AS tokensReasoning,
              COALESCE(SUM(${T_CR}),0) AS tokensCacheRead,
              COALESCE(SUM(${T_CW}),0) AS tokensCacheWrite
       FROM message
       WHERE json_extract(data,'$.role')='assistant'
         AND ${CREATED} >= ?
       GROUP BY grp
       ORDER BY cost DESC`,
    )
    .all(sinceMs)
  return rows.map((r) => ({
    group: String(r.grp),
    provider: String(r.provider),
    model: String(r.model),
    day: "",
    project: "",
    agent: "",
    messages: Number(r.messages),
    cost: Number(r.cost),
    tokensInput: Number(r.tokensInput),
    tokensOutput: Number(r.tokensOutput),
    tokensReasoning: Number(r.tokensReasoning),
    tokensCacheRead: Number(r.tokensCacheRead),
    tokensCacheWrite: Number(r.tokensCacheWrite),
  })) as UsageRow[]
}

export function usageTotals(db: Database, sinceMs: number): UsageTotals {
  const r = db
    .query<Record<string, unknown>, [number]>(
      `SELECT COUNT(*) AS messages,
              COALESCE(SUM(${COST}),0) AS cost,
              COALESCE(SUM(${T_IN}),0) AS tokensInput,
              COALESCE(SUM(${T_OUT}),0) AS tokensOutput
       FROM message
       WHERE json_extract(data,'$.role')='assistant' AND ${CREATED} >= ?`,
    )
    .get(sinceMs)
  return {
    messages: Number(r?.messages ?? 0),
    cost: Number(r?.cost ?? 0),
    tokensInput: Number(r?.tokensInput ?? 0),
    tokensOutput: Number(r?.tokensOutput ?? 0),
  }
}

export interface ProviderLocal {
  provider: string
  messages: number
  cost: number
  tokens: number
  lastUsedMs: number
}

export function localUsageByProvider(db: Database, sinceMs: number): Map<string, ProviderLocal> {
  const rows = db
    .query<Record<string, unknown>, [number]>(
      `SELECT COALESCE(json_extract(data,'$.providerID'),'?') AS provider,
              COUNT(*) AS messages,
              COALESCE(SUM(${COST}),0) AS cost,
              COALESCE(SUM(${T_IN} + ${T_OUT}),0) AS tokens,
              MAX(${CREATED}) AS lastUsedMs
       FROM message
       WHERE json_extract(data,'$.role')='assistant'
         AND ${CREATED} >= ?
       GROUP BY provider`,
    )
    .all(sinceMs)
  const map = new Map<string, ProviderLocal>()
  for (const r of rows) {
    map.set(String(r.provider), {
      provider: String(r.provider),
      messages: Number(r.messages),
      cost: Number(r.cost),
      tokens: Number(r.tokens),
      lastUsedMs: Number(r.lastUsedMs),
    })
  }
  return map
}
