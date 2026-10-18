# Build

`bun run build` writes the two published entry points into `dist/`:

- `dist/tui.js` — the opencode TUI plugin, named by `exports["./tui"]`
- `dist/cli.js` — the `opencode-usage` binary, named by `bin`

Both inline `@opencode-usage/core`. `@opencode/plugin`, `@opentui/*` and `solid-js`
stay external: the host maps those specifiers to its own instances, and a bundled
second copy has its calls dropped in silence.

To run the plugin from a clone, add the bundle to `plugins` in
`~/.config/opencode/opencode.json`:

```json
{ "plugins": ["/absolute/path/to/opencode-usage/dist/tui.js"] }
```

The package exports `./tui`, so the CLI picks the dialog up by itself and nothing
goes in `cli.json`. Restart opencode after a rebuild: the bundle is read once at
start.

`bun run preview` renders the dialog headless at several terminal widths, so a
layout change can be seen with no restart.
