import type { AAModel, ModelsDevModel } from "./metrics.ts"

const ALIASES: Record<string, string> = {
  "gpt-5": "gpt-5",
  "gpt-5-codex": "gpt-5-codex",
  "claude-opus-4-5": "claude-opus-5",
  "claude-sonnet-4-5": "claude-sonnet-5",
  "claude-sonnet-4": "claude-sonnet-4",
  "claude-3-5-sonnet": "claude-35-sonnet",
  "gemini-2-5-pro": "gemini-2-5-pro",
  "gemini-2-5-flash": "gemini-2-5-flash",
  "deepseek-v3": "deepseek-v3",
  "deepseek-r1": "deepseek-r1",
  "qwen-2-5-coder": "qwen2-5-coder",
  "qwen-3": "qwen3",
  "llama-3-1-405b": "llama-3-1-405b",
  "llama-3-1-70b": "llama-3-1-70b",
  "llama-3-1-8b": "llama-3-1-8b",
  "minimax-m2-1": "minimax-m2-1",
  "command-r-plus": "command-r-plus",
  "command-r": "command-r",
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-(202[0-9]{5})$/, "")
}

function normalizeModelsDevId(id: string): string {
  const afterProvider = id.includes("/") ? id.split("/").pop() ?? id : id
  return normalize(afterProvider)
}

export function buildMatcher(
  aaModels: AAModel[],
  modelsDev: Record<string, ModelsDevModel>,
): (model: ModelsDevModel) => AAModel | undefined {
  const aaByNorm = new Map<string, AAModel>()
  for (const m of aaModels) {
    const key = normalize(m.slug ?? m.id ?? m.name)
    if (!aaByNorm.has(key)) aaByNorm.set(key, m)
    const alias = ALIASES[key]
    if (alias && !aaByNorm.has(alias)) aaByNorm.set(alias, m)
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    const m = aaModels.find((x) => normalize(x.slug ?? x.id ?? x.name) === target)
    if (m) aaByNorm.set(alias, m)
  }

  return (md: ModelsDevModel) => {
    const key = normalizeModelsDevId(md.id)
    if (aaByNorm.has(key)) return aaByNorm.get(key)
    const alias = ALIASES[key]
    if (alias && aaByNorm.has(alias)) return aaByNorm.get(alias)
    return undefined
  }
}