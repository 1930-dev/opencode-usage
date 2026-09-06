# Build

`bun run build` writes the two published entry points into `dist/`:

- `dist/tui.js` — the opencode TUI plugin, named by `exports["./tui"]`
- `dist/cli.js` — the `opencode-usage` binary, named by `bin`

Both inline `@opencode-usage/core`. `@opencode-ai/*` and `@opentui/*` stay
external: the host maps those specifiers to its own instances, and a bundled
second copy has its calls dropped in silence.

To run the plugin from a clone, point `~/.config/opencode/tui.json` at the
bundle:

```json
{ "plugin": ["/absolute/path/to/opencode-usage/dist/tui.js"] }
```

Use `tui.json`. `opencode.json` and `~/.config/opencode/plugins/` are both
loaded as *server* plugins, and opencode rejects a TUI-only module there.
Restart opencode after a rebuild: the bundle is read once at start.

`bun run preview` renders the dialog headless at several terminal widths, so a
layout change can be seen with no restart.
