import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "path"
import { cacheDir } from "../config.ts"
import type { AAModel, ModelsDevModel } from "./metrics.ts"

const TTL_MS = 24 * 60 * 60 * 1000

async function readCache<T>(file: string): Promise<T | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(cacheDir(), file), "utf8")) as { fetchedAt: number; data: T }
    if (Date.now() - raw.fetchedAt > TTL_MS) return null
    return raw.data
  } catch {
    return null
  }
}

async function writeCache<T>(file: string, data: T): Promise<void> {
  await mkdir(cacheDir(), { recursive: true })
  await writeFile(path.join(cacheDir(), file), JSON.stringify({ fetchedAt: Date.now(), data }))
}

export async function fetchModelsDev(): Promise<Record<string, ModelsDevModel>> {
  const cached = await readCache<Record<string, ModelsDevModel>>("models-dev.json")
  if (cached) return cached
  const res = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`models.dev fetch failed: HTTP ${res.status}`)
  const data = (await res.json()) as Record<string, { models: Record<string, ModelsDevModel> }>
  const flat: Record<string, ModelsDevModel> = {}
  for (const provider of Object.values(data)) {
    for (const [id, model] of Object.entries(provider.models)) {
      flat[id] = model
    }
  }
  await writeCache("models-dev.json", flat)
  return flat
}

/**
 * The Artificial Analysis key, from the environment. Ranking is optional: with
 * no key `top` still prints prices from models.dev, only without the indices.
 * A free key is at https://artificialanalysis.ai/data-api — its terms are
 * "internal use only; no redistribution", which is why this package ships no
 * key and no snapshot of the data.
 */
function aaApiKey(): string | undefined {
  return process.env.AA_API_KEY || undefined
}

export async function fetchAA(): Promise<AAModel[]> {
  const cached = await readCache<AAModel[]>("aa.json")
  if (cached) return cached
  const key = aaApiKey()
  if (!key) return []
  const res = await fetch("https://artificialanalysis.ai/api/v2/data/llms/models", {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`AA fetch failed: HTTP ${res.status}`)
  const data = (await res.json()) as { data: AAModel[] }
  await writeCache("aa.json", data.data)
  return data.data
}
