/**
 * Builds the two published entry points into dist/:
 *   dist/tui.js  — the opencode TUI plugin, named by exports["./tui"]
 *   dist/cli.js  — the opencode-usage binary, named by bin
 *
 * Both inline @opencode-usage/core, so the published package has no workspace
 * dependency to resolve. @opencode-ai/* and @opentui/* stay external: the host
 * maps those specifiers to its own instances at runtime, and a bundled second
 * copy has its calls dropped silently.
 */
import { resolve } from "path"

process.env.NODE_ENV = "production"

const ROOT = resolve(import.meta.dir, "..")
const DIST = resolve(ROOT, "dist")
const EXTERNAL = ["@opencode-ai/plugin", "@opencode-ai/plugin/tui", "@opencode-ai/sdk", "@opentui/*", "solid-js", "solid-js/*"]

async function build(entry: string, out: string, shebang = false): Promise<void> {
  const result = await Bun.build({
    entrypoints: [resolve(ROOT, entry)],
    outdir: DIST,
    naming: `${out}.[ext]`,
    target: "bun",
    format: "esm",
    external: EXTERNAL,
    define: { "process.env.NODE_ENV": '"production"' },
  })
  if (!result.success) {
    console.error(result.logs)
    process.exit(1)
  }
  const path = resolve(DIST, `${out}.js`)
  if (!(await Bun.file(path).exists())) {
    console.error(`build produced no ${path}; outputs: ${result.outputs.map((o) => o.path).join(", ")}`)
    process.exit(1)
  }
  if (shebang) {
    // Bun keeps the entry file's own shebang, but buried under the bundle
    // preamble where it is a syntax error. Strip it and put one on line 1.
    const body = (await Bun.file(path).text()).replace(/^#!.*\n/gm, "")
    await Bun.write(path, `#!/usr/bin/env bun\n${body}`)
    await Bun.$`chmod +x ${path}`
  }
  console.log(`built ${path}`)
}

await build("packages/plugin/tui.tsx", "tui")
await build("packages/cli/src/cli.ts", "cli", true)
