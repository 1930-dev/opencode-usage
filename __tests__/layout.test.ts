import { describe, it, expect } from "bun:test"
import {
  barColor,
  budgetTail,
  chooseSize,
  columnsFor,
  compactLabel,
  fmtTokens,
  pad,
  progressBar,
  row,
  toHex,
  widthNeeded,
  windowSuffix,
  COMPACT_BAR,
  SIZE_WIDTH,
  WIDE_BAR,
  type Palette,
} from "../packages/plugin/layout.ts"

const PALETTE: Palette = {
  accent: "#a277ff",
  text: "#e5e5e5",
  muted: "#8a8a8a",
  subtle: "#4a4a4a",
  ok: "#4ade80",
  warn: "#facc15",
  danger: "#f87171",
}

describe("columnsFor", () => {
  it("uses the wide profile at 80 columns and up", () => {
    const { cols, bar } = columnsFor(86)
    expect(cols.map((c) => c.title)).toEqual(["PROVIDER", "MSGS", "TOK IN", "TOK OUT", "COST", "BUDGET"])
    expect(bar).toBe(WIDE_BAR)
  })

  it("shortens the headers below 80 columns", () => {
    const { cols, bar } = columnsFor(58)
    expect(cols.map((c) => c.title)).toEqual(["PROVIDER", "MSGS", "IN", "OUT", "COST", "BUDGET"])
    expect(bar).toBe(COMPACT_BAR)
  })

  it("gives BUDGET every column the others do not take", () => {
    const narrow = columnsFor(80).cols.at(-1)!.width
    const wide = columnsFor(114).cols.at(-1)!.width
    expect(wide - narrow).toBe(34)
  })

  it("never shrinks BUDGET below a bar plus a percentage", () => {
    expect(columnsFor(10).cols.at(-1)!.width).toBe(14)
  })

  it("fills exactly the width it is given, once wide", () => {
    const { cols } = columnsFor(114)
    expect(cols.reduce((a, c) => a + c.width, 0) + cols.length - 1).toBe(114)
  })
})

describe("fmtTokens", () => {
  it("scales to K and M, and stops there", () => {
    expect(fmtTokens(0)).toBe("0")
    expect(fmtTokens(999)).toBe("999")
    expect(fmtTokens(10_900)).toBe("10.9K")
    expect(fmtTokens(10_900_000)).toBe("10.9M")
  })
})

describe("pad", () => {
  it("pads to the side the alignment names", () => {
    expect(pad("ab", 5, "left")).toBe("ab   ")
    expect(pad("ab", 5, "right")).toBe("   ab")
  })

  it("truncates rather than breaking the column", () => {
    expect(pad("abcdefg", 3, "left")).toBe("abc")
    expect(pad("abc", 3, "right")).toBe("abc")
  })
})

describe("row", () => {
  it("joins the cells with one space", () => {
    const cols = columnsFor(58).cols.slice(0, 2)
    expect(row(cols, ["groq", "12"])).toBe("groq              12")
  })

  it("leaves a cell it was given no value for empty", () => {
    const cols = columnsFor(58).cols.slice(0, 2)
    expect(row(cols, ["groq"])).toBe("groq                ")
  })
})

describe("progressBar", () => {
  it("fills in proportion to the percentage", () => {
    expect(progressBar(0, 10)).toBe("░".repeat(10))
    expect(progressBar(50, 10)).toBe("█".repeat(5) + "░".repeat(5))
    expect(progressBar(100, 10)).toBe("█".repeat(10))
  })

  it("clamps a percentage outside 0..100", () => {
    expect(progressBar(-20, 4)).toBe("░░░░")
    expect(progressBar(140, 4)).toBe("████")
  })
})

describe("compactLabel", () => {
  it("shortens the magnitudes and clips the nouns", () => {
    expect(compactLabel("1,000,000 tokens/day")).toBe("1M tok/day")
    expect(compactLabel("1,500 requests/day")).toBe("1.5K req/day")
    expect(compactLabel("100 credits/month")).toBe("100 credits/month")
  })

  it("leaves a label with no number alone", () => {
    expect(compactLabel("weekly")).toBe("weekly")
    expect(compactLabel("premium/mo")).toBe("premium/mo")
  })
})

describe("windowSuffix", () => {
  it("keeps the window the percentage is measured over", () => {
    expect(windowSuffix("5h")).toBe("5h")
    expect(windowSuffix("1,000,000 tokens/year")).toBe("yr")
    expect(windowSuffix("premium/mo")).toBe("mo")
    expect(windowSuffix("200,000 tokens/month")).toBe("mo")
    expect(windowSuffix("weekly")).toBe("wk")
    expect(windowSuffix("credits/wk")).toBe("wk")
    expect(windowSuffix("200,000 tokens/day")).toBe("d")
    expect(windowSuffix("daily")).toBe("d")
    expect(windowSuffix("hourly")).toBe("h")
  })

  it("returns nothing when the label names no window", () => {
    expect(windowSuffix("credits")).toBe("")
  })
})

describe("budgetTail", () => {
  it("shows the percentage and the full label when both fit", () => {
    expect(budgetTail(42, "1,000,000 tokens/day", 30, WIDE_BAR)).toBe("  42% 1M tok/day")
  })

  it("falls back to the window when the label does not fit", () => {
    expect(budgetTail(42, "1,000,000 tokens/day", 20, WIDE_BAR)).toBe("  42% d")
  })

  it("never overflows its column", () => {
    const tail = budgetTail(100, "1,000,000 tokens/day", 16, COMPACT_BAR)
    expect(tail.length).toBeLessThanOrEqual(16 - COMPACT_BAR)
  })

  it("right-aligns the percentage so the numbers line up", () => {
    expect(budgetTail(7, "weekly", 30, WIDE_BAR).startsWith("   7% ")).toBe(true)
    expect(budgetTail(100, "weekly", 30, WIDE_BAR).startsWith(" 100% ")).toBe(true)
  })
})

describe("toHex", () => {
  it("passes a string through", () => {
    expect(toHex("#123456", "#000000")).toBe("#123456")
  })

  it("scales a 0..1 triple", () => {
    expect(toHex({ r: 1, g: 0, b: 0.5 }, "#000000")).toBe("#ff0080")
  })

  it("takes a 0..255 triple as it is", () => {
    expect(toHex({ r: 255, g: 128, b: 0 }, "#000000")).toBe("#ff8000")
  })

  it("clamps a component outside the range", () => {
    expect(toHex({ r: 300, g: -5, b: 10 }, "#000000")).toBe("#ff000a")
  })

  it("falls back for anything that is not a color", () => {
    expect(toHex(undefined, "#a277ff")).toBe("#a277ff")
    expect(toHex({}, "#a277ff")).toBe("#a277ff")
    expect(toHex({ r: 1, g: 1 }, "#a277ff")).toBe("#a277ff")
    expect(toHex(42, "#a277ff")).toBe("#a277ff")
  })
})

describe("barColor", () => {
  it("warns before it is too late, and only then goes red", () => {
    expect(barColor(0, PALETTE)).toBe(PALETTE.ok)
    expect(barColor(69, PALETTE)).toBe(PALETTE.ok)
    expect(barColor(70, PALETTE)).toBe(PALETTE.warn)
    expect(barColor(89, PALETTE)).toBe(PALETTE.warn)
    expect(barColor(90, PALETTE)).toBe(PALETTE.danger)
    expect(barColor(100, PALETTE)).toBe(PALETTE.danger)
  })
})

describe("chooseSize", () => {
  it("takes the large frame when the content fits it", () => {
    expect(chooseSize(200, 60)).toBe("large")
    expect(chooseSize(90, 60)).toBe("large")
  })

  it("only asks for xlarge when a label needs it", () => {
    expect(chooseSize(200, SIZE_WIDTH.large)).toBe("xlarge")
  })

  it("stays at large when the terminal cannot hold xlarge", () => {
    expect(chooseSize(118, SIZE_WIDTH.large)).toBe("xlarge")
    expect(chooseSize(117, SIZE_WIDTH.large)).toBe("large")
  })

  it("falls back to medium on a narrow terminal", () => {
    expect(chooseSize(70, 60)).toBe("medium")
    expect(chooseSize(40, 0)).toBe("medium")
  })
})

describe("widthNeeded", () => {
  it("grows one column per column of label", () => {
    expect(widthNeeded(10) - widthNeeded(0)).toBe(10)
  })

  it("fits the large frame when no provider reports a label", () => {
    expect(widthNeeded(0)).toBeLessThanOrEqual(SIZE_WIDTH.large - 2)
  })
})
