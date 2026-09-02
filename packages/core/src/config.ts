import path from "path"

function home(): string {
  const h = process.env.HOME
  if (!h) throw new Error("HOME is not set")
  return h
}

export function dbPath(): string {
  return process.env.OPENCODE_DB_PATH ?? path.join(home(), ".local/share/opencode/opencode.db")
}

export function authPath(): string {
  return process.env.OPENCODE_AUTH_PATH ?? path.join(home(), ".local/share/opencode/auth.json")
}

export function cacheDir(): string {
  return process.env.OPENCODE_USAGE_CACHE ?? path.join(home(), ".cache/opencode-usage")
}

export function budgetsPath(): string {
  return process.env.OPENCODE_USAGE_BUDGETS ?? path.join(home(), ".config/opencode-usage/budgets.json")
}

export function infisicalProjectId(): string {
  return process.env.INFISICAL_PROJECT_ID ?? "***REMOVED***"
}
