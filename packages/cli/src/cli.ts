#!/usr/bin/env bun
/**
 * The binary. It holds no logic on purpose: every command lives in main.ts,
 * which a test can import and drive. This file only turns a failure into an
 * exit code, which a test cannot do without killing the runner.
 */
import { run } from "./main.ts"

if (import.meta.main) {
  try {
    await run(process.argv.slice(2))
  } catch (err) {
    console.error(`opencode-usage: ${(err as Error).message}\n`)
    process.exit(1)
  }
}
