# Build

tui.jsx is built by `bun build` into a single file for opencode to load.

```bash
cd packages/plugin
bun build tui.tsx --outdir dist
cp dist/tui.js ~/.config/opencode/plugins/opencode-usage.js
```

The plugin exposes a `/usage` slash command in opencode's TUI.
