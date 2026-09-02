import { resolve } from "node:path"

const OUT = resolve(import.meta.dir, "dist/opencode-usage.js")

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "tui.tsx")],
  outfile: OUT,
  target: "bun",
  format: "esm",
})

if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}
console.log(`built ${OUT}`)
