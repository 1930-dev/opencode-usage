import { fetchAA, fetchModelsDev } from "./ranking/fetch.ts"
import { buildMatcher } from "./ranking/matcher.ts"
import { blendedPrice, valueScore, getIntelligenceIndex, type AAModel, type ModelsDevModel } from "./ranking/metrics.ts"

export interface TopRow {
  model: string
  name: string
  intelligence: number | undefined
  codingIndex: number | undefined
  blended: number
  value: number | undefined
}

export async function buildTop(limit: number): Promise<TopRow[]> {
  const [modelsDev, aaModels] = await Promise.all([fetchModelsDev(), fetchAA()])
  const match = buildMatcher(aaModels, modelsDev)
  const seen = new Set<string>()
  const rows: TopRow[] = []
  for (const [id, md] of Object.entries(modelsDev)) {
    if (!md.cost || md.cost.input === 0) continue
    const modelId = id.includes("/") ? id.split("/").pop()! : id
    const key = `${modelId}`
    if (seen.has(key)) continue
    const aa: AAModel | undefined = match(md as ModelsDevModel & { id: string })
    const ii = aa ? getIntelligenceIndex(aa) : undefined
    const coding = aa?.evaluations?.artificial_analysis_coding_index ?? undefined
    const bp = blendedPrice(md.cost)
    const vs = valueScore(ii, md.cost)
    seen.add(key)
    rows.push({ model: modelId, name: md.name ?? modelId, intelligence: ii, codingIndex: coding, blended: bp, value: vs })
  }
  rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  return rows.slice(0, limit)
}
