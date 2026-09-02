const result = await Bun.build({
  entrypoints: ["./tui.tsx"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  packages: "external",
})
if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}
console.log(`built ${result.outputs[0].path}`)
