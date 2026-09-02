import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "path"
import { cacheDir } from "./config.ts"
import { readAuth, authSecret, type AuthStore } from "./auth.ts"
import { fetchZen } from "./quota/zen.ts"
import { fetchOpenRouter } from "./quota/openrouter.ts"
import { fetchCopilot } from "./quota/copilot.ts"
import { fetchZai } from "./quota/zai.ts"
import type { ProviderQuota } from "./quota/shared.ts"

const TTL_MS = 15 * 60 * 1000

interface CacheFile {
  fetchedAt: number
  quotas: Record<string, ProviderQuota>
}

export interface ProviderStatus {
  provider: string
  auth: boolean
  quota: ProviderQuota | null
  quotaSource: "live" | "cache" | "none"
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(cacheDir(), "quota.json"), "utf8")) as CacheFile
    if (Date.now() - raw.fetchedAt > TTL_MS) return null
    return raw
  } catch {
    return null
  }
}

async function writeCache(quotas: Record<string, ProviderQuota>): Promise<void> {
  await mkdir(cacheDir(), { recursive: true })
  const file: CacheFile = { fetchedAt: Date.now(), quotas }
  await writeFile(path.join(cacheDir(), "quota.json"), JSON.stringify(file))
}

const FETCHERS: Record<string, (secret: string) => Promise<ProviderQuota>> = {
  "opencode-go": fetchZen,
  openrouter: fetchOpenRouter,
  "github-copilot": fetchCopilot,
  zai: fetchZai,
}

export async function providerStatuses(opts: { noNet: boolean }): Promise<ProviderStatus[]> {
  const auth: AuthStore = await readAuth()
  const providers = Object.keys(auth).sort()

  let cached: Record<string, ProviderQuota> = {}
  let quotaSource: ProviderStatus["quotaSource"] = "none"
  if (opts.noNet) {
    const c = await readCache()
    if (c) {
      cached = c.quotas
      quotaSource = "cache"
    }
  } else {
    const c = await readCache()
    const fresh: Record<string, ProviderQuota> = {}
    const live = await Promise.all(
      providers.map(async (p) => {
        const fetcher = FETCHERS[p]
        const secret = authSecret(auth[p])
        if (!fetcher || !secret) return null
        return fetcher(secret)
      }),
    )
    for (const q of live) {
      if (q) fresh[q.provider] = q
    }
    if (Object.keys(fresh).length > 0) {
      await writeCache(fresh)
      cached = fresh
      quotaSource = "live"
    } else if (c) {
      cached = c.quotas
      quotaSource = "cache"
    }
  }

  return providers.map((p) => ({
    provider: p,
    auth: true,
    quota: cached[p] ?? null,
    quotaSource: cached[p] ? quotaSource : "none",
  }))
}
