# opencode-usage

Usage tracking, budget percentages and model ranking for [opencode](https://opencode.ai):
a CLI, and a `/usage` slash command for the TUI.

## Install

```bash
npm install -g @1930dev/opencode-usage   # the opencode-usage CLI
```

Requires [Bun](https://bun.sh): the CLI reads opencode's SQLite through `bun:sqlite`.

## Usage

```bash
# Local usage from opencode's SQLite (all providers, all projects)
opencode-usage usage                    # last 7 days, grouped by provider

# Window
opencode-usage usage --today            # today only
opencode-usage usage --since 30d        # last 30 days

# Grouping
opencode-usage usage --by agent         # by agent (build/plan/etc)
opencode-usage usage --by day           # by day
opencode-usage usage --by model         # by model
opencode-usage usage --by project       # by project directory
opencode-usage usage --by provider      # the default; lists every connected
                                        # provider, idle ones included

# Output
opencode-usage usage --json             # machine-readable
opencode-usage usage --pct              # add the % BUDGET column (--by provider only)

# Connected providers + live quota
opencode-usage providers
opencode-usage providers --no-net       # cached only

# Model ranking by intelligence per blended dollar
opencode-usage top
opencode-usage top --limit 10 --json
```

## Plugin for opencode

The package also ships a `/usage` slash command for the opencode TUI. It shows the
same table as the CLI, with the % budget column drawn as a progress bar.

```bash
opencode plugin @1930dev/opencode-usage
```

That installs the package and writes it into `~/.config/opencode/tui.json`. To do it
by hand:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@1930dev/opencode-usage"]
}
```

TUI plugins go in `tui.json`, not in `opencode.json` and not in
`~/.config/opencode/plugins/`. Both of those are loaded as *server* plugins, and
opencode rejects a TUI-only module there with
`must default export an object with server()`.

To run it from a clone instead, build first and point `tui.json` at the bundle:

```bash
bun install && bun run build
```

```json
{ "plugin": ["/absolute/path/to/opencode-usage/dist/tui.js"] }
```

Restart opencode after a rebuild: the bundle is read once at start.

## % BUDGET (`--pct`)

Normalized percentage of budget consumed per provider, from these sources (in priority):

1. **Live quota** — provider-reported usage:
   - `github-copilot`: premium requests entitlement (7000/mo)
   - `opencode-go` (Zen): rolling 5h / weekly / monthly % (binding window)
   - `openrouter`: credits used / total credits
   - `zai`: coding plan quota

2. **Documented limits** — published quotas, used when the provider reports none:
   - `cerebras`: 1M tokens/day (free tier)
   - `cloudflare-workers-ai`: 100k neurons/day (free tier)
   - `digitalocean`: 5M tokens/day (paid)
   - `google`: 1500 requests/day (free tier)
   - `groq`: 200k tokens/day (free tier)
   - `nvidia`: 1000 credits/month (free tier)
   - `orcarouter`: undocumented
   - `snowflake-cortex`: 100 credits/month (paid)

3. **budgets.json** — your monthly USD per provider:
   ```json
   {
     "digitalocean": 5,
     "nvidia": 1
   }
   ```
   Place at `~/.config/opencode-usage/budgets.json`.

Providers without any source show `—`.

## Ranking (`top`)

Models ranked by intelligence index per blended dollar:
```
MODEL                    NAME                IQ     CODING   $/M       IQ/$
glm-5.3-flash            GLM 5.3-Flash       58     72       $0.11     534.9
...
```

Intelligence indices from [Artificial Analysis](https://artificialanalysis.ai), pricing
from [models.dev](https://models.dev).

`top` needs an `AA_API_KEY` for the indices. This package ships neither a key nor a copy
of the data: the free Data API tier is "internal use only; no redistribution", and
attribution is required on every tier — which is why the credit is printed under the
table and carried in `--json`.

## Requirements

- [Bun](https://bun.sh) >= 1.0 — the CLI reads opencode's SQLite through `bun:sqlite`
- [opencode](https://opencode.ai) with existing sessions, at
  `~/.local/share/opencode/opencode.db`
- For live quota: provider credentials already configured in opencode, at
  `~/.local/share/opencode/auth.json`

## Configuration

- `AA_API_KEY` — Artificial Analysis key, used by `top` for the intelligence indices.
  Optional: without it `top` still prints prices, only without `IQ` and `IQ/$`.
  A free key is at [artificialanalysis.ai/data-api](https://artificialanalysis.ai/data-api)
- `OPENCODE_AUTH_PATH` — override the path to opencode's `auth.json`
- `OPENCODE_DB_PATH` — override the path to opencode's database
- `OPENCODE_USAGE_BUDGETS` — override the path to `budgets.json`
- `OPENCODE_USAGE_CACHE` — cache directory (default `~/.cache/opencode-usage`)

## Development

```bash
bun install          # install workspace deps
bun run build        # write dist/tui.js and dist/cli.js
bun run preview      # render the /usage dialog headless, at several widths
bun test             # run tests
bunx tsc --noEmit    # typecheck
```

The workspace is a Bun monorepo. The packages are listed by dependency order,
since `cli` and `plugin` both build on `core`:

- `@opencode-usage/core` — shared data layer (SQLite, quotas, matching, ranking)
- `@opencode-usage/cli` — the `opencode-usage` binary
- `@opencode-usage/plugin` — the opencode TUI plugin

Only the root package is published; `core` is inlined into both bundles.

## License

MIT