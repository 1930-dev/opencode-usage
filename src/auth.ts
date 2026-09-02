import { readFile } from "node:fs/promises"
import { authPath } from "./config.ts"

export interface AuthEntry {
  type: string
  key?: string
  access?: string
  metadata?: Record<string, unknown>
}

export type AuthStore = Record<string, AuthEntry>

export async function readAuth(): Promise<AuthStore> {
  try {
    return JSON.parse(await readFile(authPath(), "utf8")) as AuthStore
  } catch (err) {
    throw new Error(`cannot read opencode auth store: ${(err as Error).message}`)
  }
}

export function authSecret(entry: AuthEntry): string | undefined {
  return entry.key ?? entry.access
}
