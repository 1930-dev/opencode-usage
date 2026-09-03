import { resolve } from "path"

const OUT = resolve(import.meta.dir, "dist/opencode-usage.js")

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "tui.tsx")],
  outdir: resolve(import.meta.dir, "dist"),
  target: "bun",
  format: "esm",
  packages: "external",
})
if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}
console.log(`built ${OUT}`)
