// @bun
// tui.tsx
import { jsxDEV } from "@opentui/solid/jsx-dev-runtime";
var CLI = `${process.env.HOME}/Code/opencode-usage/packages/cli/src/cli.ts`;
function fmtT(n) {
  if (n >= 1e6)
    return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000)
    return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
function progressBar(pct, width = 14) {
  const filled = Math.round(Math.min(pct, 100) / 100 * width);
  return "\u2588".repeat(Math.max(0, filled)) + "\u2591".repeat(Math.max(0, width - filled));
}
function barColor(pct) {
  if (pct >= 90)
    return "#f87171";
  if (pct >= 70)
    return "#facc15";
  return "#4ade80";
}
var tui = async (api) => {
  api.command.register(() => [
    {
      title: "Show usage",
      value: "opencode-usage.show",
      slash: { name: "usage" },
      onSelect: async (dialog) => {
        const cols = ["PROVIDER", "MSGS", "TOK IN", "TOK OUT", "EST COST", "BUDGET"];
        const widths = [20, 5, 8, 8, 10, 22];
        const pad = (s, w) => s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
        const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join("  ");
        const proc = Bun.spawn(["bun", CLI, "usage", "--pct", "--today"], { stdout: "pipe", stderr: "pipe" });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        let snap;
        try {
          snap = JSON.parse(out);
        } catch {
          dialog.replace(() => /* @__PURE__ */ jsxDEV("text", {
            children: "Failed to load usage data \u2014 is opencode-usage installed?"
          }, undefined, false, undefined, this));
          return;
        }
        dialog.replace(() => /* @__PURE__ */ jsxDEV(api.ui.Dialog, {
          size: "xlarge",
          onClose: () => api.ui.dialog.clear(),
          children: /* @__PURE__ */ jsxDEV("box", {
            flexDirection: "column",
            padding: 1,
            children: [
              /* @__PURE__ */ jsxDEV("text", {
                bold: true,
                children: "Usage \u2014 last 24h"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("text", {}, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("text", {
                color: "#888",
                children: line(cols)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("text", {
                color: "#555",
                children: "-".repeat(cols.reduce((a, _, i) => a + widths[i], 0) + (cols.length - 1) * 2)
              }, undefined, false, undefined, this),
              snap.rows.slice(0, 20).map((r) => {
                const p = snap.pct?.[r.provider];
                return /* @__PURE__ */ jsxDEV("box", {
                  flexDirection: "row",
                  children: [
                    /* @__PURE__ */ jsxDEV("text", {
                      width: 20,
                      children: r.provider.slice(0, 20)
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV("text", {
                      width: 5,
                      children: String(r.messages).padEnd(5)
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV("text", {
                      width: 8,
                      children: fmtT(r.tokensInput).padEnd(8)
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV("text", {
                      width: 8,
                      children: fmtT(r.tokensOutput).padEnd(8)
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV("text", {
                      width: 10,
                      children: `$${r.cost.toFixed(2)}`.padEnd(10)
                    }, undefined, false, undefined, this),
                    p ? /* @__PURE__ */ jsxDEV("text", {
                      children: [
                        /* @__PURE__ */ jsxDEV("span", {
                          fg: barColor(p.pct),
                          children: progressBar(p.pct)
                        }, undefined, false, undefined, this),
                        " ",
                        p.pct.toFixed(0),
                        "% ",
                        p.label ?? p.source
                      ]
                    }, undefined, true, undefined, this) : /* @__PURE__ */ jsxDEV("text", {
                      color: "#555",
                      children: "\u2014"
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this);
              }),
              /* @__PURE__ */ jsxDEV("text", {}, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("text", {
                bold: true,
                children: [
                  "TOTAL: ",
                  snap.totals.messages,
                  " msgs, $",
                  snap.totals.cost.toFixed(2),
                  " est."
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this));
      }
    }
  ]);
};
var tui_default = { id: "opencode-usage", tui };
export {
  tui,
  tui_default as default
};
