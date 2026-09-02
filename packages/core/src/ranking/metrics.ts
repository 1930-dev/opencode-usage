export interface ModelCost {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
}

export interface AAModel {
  id: string
  name: string
  slug: string
  evaluations?: {
    artificial_analysis_intelligence_index?: number | null
    artificial_analysis_coding_index?: number | null
  }
  pricing?: {
    price_1m_blended_3_to_1?: number
    price_1m_input_tokens?: number
    price_1m_output_tokens?: number
  }
}

export function getIntelligenceIndex(model: AAModel): number | undefined {
  return model.evaluations?.artificial_analysis_intelligence_index ?? undefined
}

export interface ModelsDevModel {
  id: string
  name: string
  cost?: ModelCost
  limit?: { context: number; output: number }
}

export function blendedPrice(cost: ModelCost): number {
  const input = cost.input ?? 0
  const output = cost.output ?? 0
  return (3 * input + 1 * output) / 4
}

export function valueScore(intelligenceIndex: number | undefined, cost: ModelCost): number | undefined {
  if (intelligenceIndex === undefined || intelligenceIndex <= 0) return undefined
  const bp = blendedPrice(cost)
  if (bp <= 0) return undefined
  return intelligenceIndex / bp
}

export function formatSuffix(
  cost: ModelCost | undefined,
  intelligenceIndex: number | undefined,
): string {
  if (!cost || cost.input === 0) return ""
  const bp = blendedPrice(cost)
  const vs = valueScore(intelligenceIndex, cost)
  const priceStr = `$${bp.toFixed(bp < 1 ? 2 : 0)}/M`
  const valueStr = vs !== undefined ? ` · ${vs.toFixed(1)}` : ""
  return ` · ${priceStr}${valueStr}`
}