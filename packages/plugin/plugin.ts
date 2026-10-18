/**
 * The package's main export. OpenCode discovers a plugin through its main
 * entrypoint and then loads `./tui` beside it, so a package that exports only
 * `./tui` is never picked up.
 *
 * There is nothing to register here: the dialog reads the local SQLite and the
 * local auth store, which belong to the machine running the terminal, not to
 * the server. This module exists so the package is a loadable plugin.
 */
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-usage.server",
  setup() {},
})