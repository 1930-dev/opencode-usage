# opencode-usage

Usage tracking, cost estimation, and model ranking CLI for [opencode](https://opencode.ai).

## Install

```bash
git clone https://github.com/agurod42/opencode-usage
cd opencode-usage
bun install
ln -s $(pwd)/packages/cli/src/cli.ts ~/.local/bin/opencode-usage
```

## Usage

```bash
# Local usage from opencode's SQLite (all providers, all projects)
opencode-usage usage                    # last 7 days, grouped by provider
opencode-usage usage --today            # today only
opencode-usage usage --since 30d        # last 30 days
opencode-usage usage --by model         # group by model instead of provider
opencode-usage usage --by project       # group by project directory
opencode-usage usage --by agent         # group by agent (build/plan/etc)
opencode-usage usage --pct              # add % BUDGET column (requires --by provider)
opencode-usage usage --json             # machine-readable output

# Connected providers + live quota
opencode-usage providers
opencode-usage providers --no-net       # cached only

# Model ranking by intelligence per blended dollar
opencode-usage top
opencode-usage top --limit 10 --json
```

## Plugin for opencode

The `packages/plugin` package adds a `/usage` slash command to the opencode TUI. It shows the
same table as the CLI, with the % budget column drawn as a progress bar.

Build the bundle, then declare it in the TUI config:

```bash
bun run build   # writes packages/plugin/dist/opencode-usage.js
```

```json
// ~/.config/opencode/tui.json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-usage/packages/plugin/dist/opencode-usage.js"]
}
```

TUI plugins go in `tui.json`, not in `opencode.json` and not in `~/.config/opencode/plugins/`.
Both of those are loaded as *server* plugins, and opencode rejects this bundle there with
`must default export an object with server()`.

Restart opencode after a rebuild: the bundle is read once at start.

## % BUDGET (`--pct`)

Normalized percentage of budget consumed per provider, from these sources (in priority):

1. **Live quota** — provider-reported usage:
   - `opencode-go` (Zen): rolling 5h / weekly / monthly % (binding window)
   - `github-copilot`: premium requests entitlement (7000/mo)
   - `openrouter`: credits used / total credits
   - `zai`: coding plan quota

2. **Documented limits** — monthly equivalent of daily limits:
   - `groq`: 200k tokens/day → 6M/month
   - `google`: 1500 requests/day → 45k/month
   - `digitalocean`: 5M tokens/day → 150M/month
   - `cerebras`: 1M tokens/day → 30M/month
   - `google` (Gemini free): 1500 requests/day → 45k/month
   - `groq`: 200k tokens/day → 6M/month
   - `cerebras`: 1M tokens/day → 30M/month

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

Data from [Artificial Analysis](https://artificialanalysis.ai) (Intelligence Index v4.1) + [models.dev](https://models.dev) pricing.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- [opencode](https://opencode.ai) with existing sessions (reads `~/.local/share/opencode/opencode.db`)
- For live quota: credentials already configured in opencode (`~/.local/share/opencode/auth.json`)

## Configuration

- `OPENCODE_DB_PATH` — override opencode database path
- `OPENCODE_AUTH_PATH` — override auth.json path
- `OPENCODE_IMP_CACHE` — cache directory (default `~/.cache/opencode-usage`)
- `OPENCODE_IMP_BUDGETS` — budgets.json path
- `INFISICAL_PROJECT_ID` — for Artificial Analysis API key (default: project ID for this repo)

## Development

```bash
bun install        # install workspace deps
bun test           # run tests
bunx tsc --noEmit  # typecheck
```

The workspace is a Bun monorepo with three packages:
- `@opencode-usage/core` — shared data layer (SQLite, quotas, matching)
- `@opencode-usage/cli` — the `opencode-usage` CLI
- `@opencode-usage/plugin` — TUI plugin for opencode itself

## License

MIT