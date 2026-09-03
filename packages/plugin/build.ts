import { resolve } from "path"

const DIST = resolve(import.meta.dir, "dist")
const OUT = resolve(DIST, "opencode-usage.js")

// Force the production JSX runtime; the host maps @opentui/solid/jsx-runtime
// to its own module instance, and jsx-dev-runtime is not part of that map.
process.env.NODE_ENV = "production"

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "tui.tsx")],
  outdir: DIST,
  naming: "opencode-usage.[ext]",
  target: "bun",
  format: "esm",
  // The TUI host owns these; the plugin must reuse the host's instances.
  external: ["@opencode-ai/plugin", "@opencode-ai/plugin/tui", "@opencode-ai/sdk", "@opentui/*", "solid-js", "solid-js/*"],
  define: { "process.env.NODE_ENV": '"production"' },
})
if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}
if (!(await Bun.file(OUT).exists())) {
  console.error(`build produced no ${OUT}; outputs: ${result.outputs.map((o) => o.path).join(", ")}`)
  process.exit(1)
}
console.log(`built ${OUT}`)
