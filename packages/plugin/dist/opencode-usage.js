// @bun
// packages/core/src/types.ts
function startOfDayMs(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonthMs(now = Date.now()) {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
// packages/core/src/db.ts
import { Database } from "bun:sqlite";

// packages/core/src/config.ts
import path from "path";
function home() {
  const h = process.env.HOME;
  if (!h)
    throw new Error("HOME is not set");
  return h;
}
function dbPath() {
  return process.env.OPENCODE_DB_PATH ?? path.join(home(), ".local/share/opencode/opencode.db");
}
function authPath() {
  return process.env.OPENCODE_AUTH_PATH ?? path.join(home(), ".local/share/opencode/auth.json");
}
function cacheDir() {
  return process.env.OPENCODE_USAGE_CACHE ?? path.join(home(), ".cache/opencode-usage");
}
function budgetsPath() {
  return process.env.OPENCODE_USAGE_BUDGETS ?? path.join(home(), ".config/opencode-usage/budgets.json");
}

// packages/core/src/db.ts
function openDb() {
  const db = new Database(dbPath(), { readonly: true });
  db.exec("PRAGMA query_only = true");
  return db;
}
var COST = "CAST(json_extract(data,'$.cost') AS REAL)";
var T_IN = "CAST(json_extract(data,'$.tokens.input') AS INTEGER)";
var T_OUT = "CAST(json_extract(data,'$.tokens.output') AS INTEGER)";
var T_REA = "CAST(json_extract(data,'$.tokens.reasoning') AS INTEGER)";
var T_CR = "CAST(json_extract(data,'$.tokens.cache.read') AS INTEGER)";
var T_CW = "CAST(json_extract(data,'$.tokens.cache.write') AS INTEGER)";
var CREATED = "CAST(json_extract(data,'$.time.created') AS INTEGER)";
var GROUPS = {
  provider: "json_extract(data,'$.providerID')",
  model: "json_extract(data,'$.providerID') || '/' || json_extract(data,'$.modelID')",
  day: "strftime('%Y-%m-%d', (${" + CREATED + "})/1000, 'unixepoch')",
  project: "json_extract(data,'$.path.cwd')",
  agent: "json_extract(data,'$.agent')"
};
function usageSince(db, sinceMs, groupBy = "provider") {
  const g = GROUPS[groupBy];
  const rows = db.query(`SELECT ${g} AS grp,
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
       ORDER BY cost DESC`).all(sinceMs);
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
    tokensCacheWrite: Number(r.tokensCacheWrite)
  }));
}
function usageTotals(db, sinceMs) {
  const r = db.query(`SELECT COUNT(*) AS messages,
              COALESCE(SUM(${COST}),0) AS cost,
              COALESCE(SUM(${T_IN}),0) AS tokensInput,
              COALESCE(SUM(${T_OUT}),0) AS tokensOutput
       FROM message
       WHERE json_extract(data,'$.role')='assistant' AND ${CREATED} >= ?`).get(sinceMs);
  return {
    messages: Number(r?.messages ?? 0),
    cost: Number(r?.cost ?? 0),
    tokensInput: Number(r?.tokensInput ?? 0),
    tokensOutput: Number(r?.tokensOutput ?? 0)
  };
}
function monthlyUsageByProvider(db, startOfMonthMs2) {
  const rows = db.query(`SELECT COALESCE(json_extract(data,'$.providerID'),'?') AS provider,
              COALESCE(SUM(CAST(json_extract(data,'$.cost') AS REAL)),0) AS cost
       FROM message
       WHERE json_extract(data,'$.role')='assistant'
         AND CAST(json_extract(data,'$.time.created') AS INTEGER) >= ?
       GROUP BY provider`).all(startOfMonthMs2);
  const map = new Map;
  for (const r of rows) {
    map.set(String(r.provider), Number(r.cost));
  }
  return map;
}
// packages/core/src/providers.ts
import { mkdir, readFile as readFile2, writeFile } from "fs/promises";
import path2 from "path";

// packages/core/src/auth.ts
import { readFile } from "fs/promises";
async function readAuth() {
  try {
    return JSON.parse(await readFile(authPath(), "utf8"));
  } catch (err) {
    throw new Error(`cannot read opencode auth store: ${err.message}`);
  }
}
function authSecret(entry) {
  return entry.key ?? entry.access;
}

// packages/core/src/quota/shared.ts
var BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
async function getJson(url, headers) {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// packages/core/src/quota/zen.ts
async function fetchZen(key) {
  try {
    const data = await getJson("https://opencode.ai/zen/go/v1/usage", {
      Authorization: `Bearer ${key}`
    });
    const u = data.usage;
    const windows = [
      { label: "5h", percentUsed: u.rolling.percent, resetsAt: u.rolling.resetsAt, status: u.rolling.status },
      { label: "weekly", percentUsed: u.weekly.percent, resetsAt: u.weekly.resetsAt, status: u.weekly.status },
      { label: "monthly", percentUsed: u.monthly.percent, resetsAt: u.monthly.resetsAt, status: u.monthly.status }
    ];
    const binding = windows.reduce((a, b) => b.percentUsed > a.percentUsed ? b : a);
    return {
      provider: "opencode-go",
      ok: true,
      windows,
      budget: { percentUsed: binding.percentUsed, label: binding.label },
      raw: data
    };
  } catch (err) {
    return { provider: "opencode-go", ok: false, detail: err.message, windows: [] };
  }
}

// packages/core/src/quota/openrouter.ts
async function fetchOpenRouter(key) {
  try {
    const credits = await getJson("https://openrouter.ai/api/v1/credits", {
      Authorization: `Bearer ${key}`
    });
    let keyInfo;
    try {
      keyInfo = (await getJson("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` })).data;
    } catch {
      keyInfo = undefined;
    }
    const totalCredits = credits.data.total_credits;
    const totalUsage = credits.data.total_usage;
    const balance = totalCredits - totalUsage;
    const pct = totalCredits > 0 ? totalUsage / totalCredits * 100 : 0;
    return {
      provider: "openrouter",
      ok: true,
      detail: `balance $${balance.toFixed(2)} of $${totalCredits.toFixed(2)}`,
      windows: keyInfo ? [
        { label: "daily", percentUsed: 0, detail: `$${keyInfo.usage_daily.toFixed(4)}` },
        { label: "weekly", percentUsed: 0, detail: `$${keyInfo.usage_weekly.toFixed(4)}` },
        { label: "monthly", percentUsed: 0, detail: `$${keyInfo.usage_monthly.toFixed(4)}` }
      ] : [],
      budget: totalCredits > 0 ? { percentUsed: pct, label: "credits" } : undefined,
      raw: { credits: credits.data, key: keyInfo }
    };
  } catch (err) {
    return { provider: "openrouter", ok: false, detail: err.message, windows: [] };
  }
}

// packages/core/src/quota/copilot.ts
function premiumBudget(s) {
  if (s.unlimited && s.entitlement === 0)
    return;
  const remaining = s.remaining ?? s.quota_remaining;
  if (remaining === undefined)
    return;
  const entitlement = s.entitlement;
  if (entitlement <= 0)
    return;
  const used = (entitlement - remaining) / entitlement * 100;
  return { percentUsed: used, label: "premium/mo" };
}
async function fetchCopilot(token) {
  try {
    const data = await getJson("https://api.github.com/copilot_internal/user", {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "X-Github-Api-Version": "2025-04-01"
    });
    const snaps = data.quota_snapshots ?? {};
    const interesting = ["premium_interactions", "completions", "chat", "agent", "preview_features"];
    const windows = Object.entries(snaps).filter(([id]) => interesting.includes(id)).map(([id, s]) => ({
      label: id.replace(/_/g, " "),
      percentUsed: s.unlimited && s.entitlement === 0 ? 0 : Math.round(100 - s.percent_remaining),
      resetsAt: data.quota_reset_date,
      detail: s.unlimited ? "unlimited" : `${s.quota_remaining} left of ${s.entitlement}`
    }));
    const budget = premiumBudget(snaps.premium_interactions) ?? premiumBudget(snaps.agent) ?? undefined;
    return {
      provider: "github-copilot",
      ok: true,
      detail: `plan ${data.copilot_plan}`,
      windows,
      budget,
      raw: data
    };
  } catch (err) {
    return { provider: "github-copilot", ok: false, detail: err.message, windows: [] };
  }
}

// packages/core/src/quota/zai.ts
function parseZai(data) {
  if (data.success === false || data.code !== undefined && data.code !== 0) {
    return { provider: "zai", ok: false, detail: data.msg ?? "quota endpoint error", windows: [] };
  }
  const limits = data.data?.limits ?? [];
  const budget = limits.length > 0 ? { percentUsed: limits[0].percentage ?? 0, label: limits[0].name ?? limits[0].limitType ?? "limit" } : undefined;
  return {
    provider: "zai",
    ok: true,
    detail: data.data?.planName,
    windows: limits.map((l) => ({
      label: l.name ?? l.limitType ?? "limit",
      percentUsed: l.percentage ?? 0,
      resetsAt: l.nextResetTime ? new Date(l.nextResetTime).toISOString() : undefined
    })),
    budget,
    raw: data
  };
}
async function fetchZai(key) {
  try {
    const data = await getJson("https://api.z.ai/api/monitor/usage/quota/limit", {
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    });
    return parseZai(data);
  } catch (err) {
    return { provider: "zai", ok: false, detail: err.message, windows: [] };
  }
}

// packages/core/src/providers.ts
var TTL_MS = 15 * 60 * 1000;
async function readCache() {
  try {
    const raw = JSON.parse(await readFile2(path2.join(cacheDir(), "quota.json"), "utf8"));
    if (Date.now() - raw.fetchedAt > TTL_MS)
      return null;
    return raw;
  } catch {
    return null;
  }
}
async function writeCache(quotas) {
  await mkdir(cacheDir(), { recursive: true });
  const file = { fetchedAt: Date.now(), quotas };
  await writeFile(path2.join(cacheDir(), "quota.json"), JSON.stringify(file));
}
var FETCHERS = {
  "opencode-go": fetchZen,
  openrouter: fetchOpenRouter,
  "github-copilot": fetchCopilot,
  zai: fetchZai
};
async function providerStatuses(opts) {
  const auth = await readAuth();
  const providers = Object.keys(auth).sort();
  let cached = {};
  let quotaSource = "none";
  if (opts.noNet) {
    const c = await readCache();
    if (c) {
      cached = c.quotas;
      quotaSource = "cache";
    }
  } else {
    const c = await readCache();
    const fresh = {};
    const live = await Promise.all(providers.map(async (p) => {
      const fetcher = FETCHERS[p];
      const secret = authSecret(auth[p]);
      if (!fetcher || !secret)
        return null;
      return fetcher(secret);
    }));
    for (const q of live) {
      if (q)
        fresh[q.provider] = q;
    }
    if (Object.keys(fresh).length > 0) {
      await writeCache(fresh);
      cached = fresh;
      quotaSource = "live";
    } else if (c) {
      cached = c.quotas;
      quotaSource = "cache";
    }
  }
  return providers.map((p) => ({
    provider: p,
    auth: true,
    quota: cached[p] ?? null,
    quotaSource: cached[p] ? quotaSource : "none"
  }));
}
// packages/core/src/ranking/fetch.ts
var TTL_MS2 = 24 * 60 * 60 * 1000;
// packages/core/src/budget.ts
import { readFile as readFile3 } from "fs/promises";
async function readBudgets() {
  try {
    return JSON.parse(await readFile3(budgetsPath(), "utf8"));
  } catch {
    return {};
  }
}
function pctFromLimit(provider, limit, usageTokens, usageRequests, isMonthly) {
  if (limit.limit <= 0)
    return;
  const effectiveLimit = limit.metric.endsWith("/day") && limit.metric !== "neurons/day" ? limit.limit * 30 : limit.limit;
  const metric = limit.metric.replace("/day", "").replace("/month", "");
  switch (metric) {
    case "tokens":
      if (effectiveLimit > 0)
        return usageTokens / effectiveLimit * 100;
      return;
    case "requests":
      if (effectiveLimit > 0)
        return usageRequests / effectiveLimit * 100;
      return;
    case "credits":
    case "neurons":
      return;
    default:
      return;
  }
}
function resolvePct(provider, live, budgets, monthCost, usageTokens, usageRequests, limits) {
  const liveQ = live.get(provider);
  if (liveQ?.budget && liveQ.ok) {
    return { pct: liveQ.budget.percentUsed, source: "live", label: liveQ.budget.label };
  }
  if (budgets[provider] !== undefined) {
    const budget = budgets[provider];
    if (budget <= 0)
      return { pct: 0, source: "budgets" };
    return { pct: monthCost / budget * 100, source: "budgets" };
  }
  const limit = limits.get(provider);
  if (limit) {
    const pct = pctFromLimit(provider, limit, usageTokens, usageRequests, true);
    if (pct !== undefined) {
      return { pct, source: "limits", label: `${limit.limit.toLocaleString()} ${limit.unit}/${limit.metric.split("/")[1]}` };
    }
  }
  return { pct: 0, source: "none" };
}
// packages/core/src/limits.ts
var PROVIDER_LIMITS = [
  {
    provider: "groq",
    metric: "tokens/day",
    limit: 200000,
    unit: "tokens",
    tier: "free",
    source: "https://console.groq.com/docs/rate-limits",
    note: "Also 30k tokens/minute. Paid tiers higher."
  },
  {
    provider: "google",
    metric: "requests/day",
    limit: 1500,
    unit: "requests",
    tier: "free",
    source: "https://ai.google.dev/gemini-api/docs/rate-limits",
    note: "Free tier: 1500 RPM, 1500 RPD. Paid tiers higher."
  },
  {
    provider: "cloudflare-workers-ai",
    metric: "neurons/day",
    limit: 1e5,
    unit: "neurons",
    tier: "free",
    source: "https://developers.cloudflare.com/workers-ai/platform/limits/",
    note: "100k neurons/day free. Workers AI paid plans higher."
  },
  {
    provider: "nvidia",
    metric: "credits/month",
    limit: 1000,
    unit: "credits",
    tier: "free",
    source: "https://build.nvidia.com/",
    note: "NIM free tier ~1000 credits/month. Varies by model."
  },
  {
    provider: "digitalocean",
    metric: "tokens/day",
    limit: 5000000,
    unit: "tokens",
    tier: "paid",
    source: "https://docs.digitalocean.com/products/genai/",
    note: "GenAI platform paid plans. Exact limits per model."
  },
  {
    provider: "snowflake-cortex",
    metric: "credits/month",
    limit: 100,
    unit: "credits",
    tier: "paid",
    source: "https://docs.snowflake.com/en/user-guide/snowflake-cortex",
    note: "Cortex functions consume credits. Budget per warehouse."
  },
  {
    provider: "cerebras",
    metric: "tokens/day",
    limit: 1e6,
    unit: "tokens",
    tier: "free",
    source: "https://cerebras.ai/",
    note: "Free tier estimate. Paid tiers much higher."
  },
  {
    provider: "orcarouter",
    metric: "tokens/day",
    limit: 0,
    unit: "tokens",
    tier: "unknown",
    source: "unknown",
    note: "Proxy service. No public limits documented."
  }
];
function limitsAsMap() {
  const m = new Map;
  for (const l of PROVIDER_LIMITS)
    m.set(l.provider, l);
  return m;
}
// packages/core/src/snapshot.ts
async function getUsageSnapshot(sinceMs, groupBy, includePct) {
  const db = openDb();
  try {
    const rows = usageSince(db, sinceMs, groupBy);
    const totals = usageTotals(db, sinceMs);
    let pct;
    if (includePct) {
      const budgets = await readBudgets();
      const live = await providerStatuses({ noNet: false });
      const liveMap = new Map;
      for (const s of live) {
        if (s.quota)
          liveMap.set(s.provider, s.quota);
      }
      const monthCosts = monthlyUsageByProvider(db, startOfMonthMs());
      const limits = limitsAsMap();
      const pctMap = new Map;
      for (const r of rows) {
        const p = resolvePct(r.provider, liveMap, budgets, monthCosts.get(r.provider) ?? 0, r.tokensInput + r.tokensOutput, r.messages, limits);
        if (p.pct > 0 || p.source !== "none")
          pctMap.set(r.provider, p);
      }
      pct = pctMap;
    }
    return { rows, totals, pct: pct ? Object.fromEntries(pct) : undefined };
  } finally {
    db.close();
  }
}
// packages/plugin/tui.tsx
import { jsx, jsxs } from "@opentui/solid/jsx-runtime";
var COMMAND = "opencode-usage.show";
var COLS = [
  { title: "PROVIDER", width: 12, align: "left" },
  { title: "MSGS", width: 4, align: "right" },
  { title: "TOK IN", width: 7, align: "right" },
  { title: "TOK OUT", width: 7, align: "right" },
  { title: "COST", width: 8, align: "right" },
  { title: "BUDGET", width: 14, align: "left" }
];
var BUDGET_COL = COLS.length - 1;
var TABLE_WIDTH = COLS.reduce((a, c) => a + c.width, 0) + (COLS.length - 1);
var BAR_WIDTH = 6;
function fmtTokens(n) {
  if (n >= 1e6)
    return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000)
    return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
function cell(s, i) {
  const { width, align } = COLS[i];
  const v = s.length > width ? s.slice(0, width) : s;
  return align === "right" ? v.padStart(width) : v.padEnd(width);
}
function line(values) {
  return values.map(cell).join(" ");
}
function progressBar(pct) {
  const filled = Math.round(Math.min(Math.max(pct, 0), 100) / 100 * BAR_WIDTH);
  return "\u2588".repeat(filled) + "\u2591".repeat(BAR_WIDTH - filled);
}
var WINDOW_ABBREV = {
  daily: "d",
  hourly: "h",
  monthly: "mo",
  session: "ss",
  weekly: "wk",
  yearly: "yr"
};
function abbrevWindow(label) {
  return WINDOW_ABBREV[label.toLowerCase()] ?? label.slice(0, 2);
}
function toHex(color, fallback) {
  if (typeof color === "string")
    return color;
  const c = color;
  if (!c || typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number")
    return fallback;
  const scale = c.r <= 1 && c.g <= 1 && c.b <= 1 ? 255 : 1;
  const hex = (v) => Math.round(Math.min(Math.max(v * scale, 0), 255)).toString(16).padStart(2, "0");
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}
function palette(api) {
  const t = api.theme?.current;
  return {
    text: toHex(t?.text, "#e5e5e5"),
    muted: toHex(t?.textMuted, "#8a8a8a"),
    subtle: toHex(t?.borderSubtle, "#4a4a4a"),
    ok: toHex(t?.success, "#4ade80"),
    warn: toHex(t?.warning, "#facc15"),
    danger: toHex(t?.error, "#f87171")
  };
}
function barColor(pct, p) {
  if (pct >= 90)
    return p.danger;
  if (pct >= 70)
    return p.warn;
  return p.ok;
}
function Header(props) {
  return /* @__PURE__ */ jsxs("box", {
    flexDirection: "row",
    justifyContent: "space-between",
    children: [
      /* @__PURE__ */ jsx("text", {
        fg: props.palette.text,
        bold: true,
        children: "Usage \u2014 today"
      }),
      /* @__PURE__ */ jsx("text", {
        fg: props.palette.muted,
        children: "esc"
      })
    ]
  });
}
function Budget(props) {
  const suffix = () => {
    const tail = ` ${props.pct.toFixed(0).padStart(3)}% ${abbrevWindow(props.label)}`;
    const room = COLS[BUDGET_COL].width - BAR_WIDTH;
    return tail.length > room ? tail.slice(0, room) : tail.padEnd(room);
  };
  return /* @__PURE__ */ jsxs("box", {
    flexDirection: "row",
    children: [
      /* @__PURE__ */ jsx("text", {
        fg: barColor(props.pct, props.palette),
        wrapMode: "none",
        children: progressBar(props.pct)
      }),
      /* @__PURE__ */ jsx("text", {
        fg: props.palette.muted,
        wrapMode: "none",
        children: suffix()
      })
    ]
  });
}
function Table(props) {
  const p = palette(props.api);
  const rows = props.snapshot.rows.slice(0, 20);
  const rule = "\u2500".repeat(TABLE_WIDTH);
  const lead = (r) => line([
    r.provider,
    String(r.messages),
    fmtTokens(r.tokensInput),
    fmtTokens(r.tokensOutput),
    `$${r.cost.toFixed(2)}`,
    ""
  ]).slice(0, TABLE_WIDTH - COLS[BUDGET_COL].width);
  return /* @__PURE__ */ jsxs("box", {
    flexDirection: "column",
    flexShrink: 0,
    paddingLeft: 1,
    paddingRight: 1,
    children: [
      /* @__PURE__ */ jsx(Header, {
        palette: p
      }),
      /* @__PURE__ */ jsx("text", {
        fg: p.muted,
        wrapMode: "none",
        children: line(COLS.map((c) => c.title))
      }),
      /* @__PURE__ */ jsx("text", {
        fg: p.subtle,
        wrapMode: "none",
        children: rule
      }),
      rows.map((r) => {
        const budget2 = props.snapshot.pct?.[r.provider];
        return /* @__PURE__ */ jsxs("box", {
          flexDirection: "row",
          children: [
            /* @__PURE__ */ jsx("text", {
              fg: p.text,
              wrapMode: "none",
              children: lead(r)
            }),
            budget2 ? /* @__PURE__ */ jsx(Budget, {
              pct: budget2.pct,
              label: budget2.label ?? budget2.source,
              palette: p
            }) : /* @__PURE__ */ jsx("text", {
              fg: p.subtle,
              wrapMode: "none",
              children: "\u2014"
            })
          ]
        });
      }),
      /* @__PURE__ */ jsx("text", {
        fg: p.subtle,
        wrapMode: "none",
        children: rule
      }),
      /* @__PURE__ */ jsx("text", {
        fg: p.text,
        bold: true,
        wrapMode: "none",
        children: line(["TOTAL", String(props.snapshot.totals.messages), "", "", `$${props.snapshot.totals.cost.toFixed(2)}`, ""])
      })
    ]
  });
}
function Message(props) {
  const p = palette(props.api);
  return /* @__PURE__ */ jsxs("box", {
    flexDirection: "column",
    flexShrink: 0,
    paddingLeft: 1,
    paddingRight: 1,
    children: [
      /* @__PURE__ */ jsx(Header, {
        palette: p
      }),
      /* @__PURE__ */ jsx("text", {}),
      /* @__PURE__ */ jsx("text", {
        fg: props.color ?? p.muted,
        children: props.text
      })
    ]
  });
}
function fitSize(api, dialog) {
  const width = api.renderer?.width ?? 128;
  dialog.setSize(width >= 128 ? "xlarge" : width >= 96 ? "large" : "medium");
}
async function show(api, dialog) {
  fitSize(api, dialog);
  dialog.replace(() => /* @__PURE__ */ jsx(Message, {
    api,
    text: "Loading usage\u2026"
  }));
  let snapshot2;
  try {
    snapshot2 = await getUsageSnapshot(startOfDayMs(), "provider", true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.replace(() => /* @__PURE__ */ jsx(Message, {
      api,
      text: `Failed to read usage: ${message}`,
      color: palette(api).danger
    }));
    return;
  }
  dialog.replace(() => /* @__PURE__ */ jsx(Table, {
    api,
    snapshot: snapshot2
  }));
}
var tui = async (api) => {
  const keymap = api.keymap;
  if (typeof keymap.registerLayer === "function") {
    keymap.registerLayer({
      commands: [
        {
          namespace: "palette",
          name: COMMAND,
          title: "Usage",
          desc: "Show opencode usage and budget per provider",
          category: "Usage",
          slashName: "usage",
          run: () => show(api, api.ui.dialog)
        }
      ]
    });
    return;
  }
  api.command?.register(() => [
    {
      title: "Usage",
      description: "Show opencode usage and budget per provider",
      value: COMMAND,
      category: "Usage",
      slash: { name: "usage" },
      onSelect: (dialog) => show(api, dialog ?? api.ui.dialog)
    }
  ]);
};
var tui_default = { id: "opencode-usage", tui };
export {
  tui,
  tui_default as default,
  Table,
  Message
};
