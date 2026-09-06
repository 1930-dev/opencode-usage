import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "path"
import { $ } from "bun"
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
 * The Artificial Analysis key. `AA_API_KEY` in the environment is the portable
 * path; the vault lookup is an opt-in convenience for machines that keep the key
 * in Infisical, and it stays behind `INFISICAL_PROJECT_ID` so this package
 * carries no vault address of anyone's. It goes through the `infisical-secret`
 * wrapper, which supplies the address and the token itself — the bare binary
 * would put a JWT in argv, where every process on the machine can read it.
 */
async function aaApiKey(): Promise<string | undefined> {
  if (process.env.AA_API_KEY) return process.env.AA_API_KEY
  const projectId = process.env.INFISICAL_PROJECT_ID
  if (!projectId) return undefined
  try {
    const out =
      await $`infisical-secret get AA_API_KEY --projectId ${projectId} --env prod --plain --silent`.text()
    return out.trim() || undefined
  } catch {
    return undefined
  }
}

export async function fetchAA(): Promise<AAModel[]> {
  const cached = await readCache<AAModel[]>("aa.json")
  if (cached) return cached
  const key = await aaApiKey()
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
