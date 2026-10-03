import { describe, expect, it } from "vitest";
import {
  collectSubagents,
  counts,
  drawsSidebarRows,
  footerText,
  headerLine,
  headerSegments,
  headerTitle,
  orderRows,
  rowCapacity,
  rowParts,
  rowWindow,
  SIDEBAR_LIMIT,
  stateOf,
  topRows,
  visibleRows,
  wrapLabel,
} from "./subagents.js";
import type { SubagentRow, SubagentSession } from "./subagents.js";
import type { State } from "./format.js";
import { MARKERS } from "./theme.js";

const T0 = 1_700_000_000_000;

function ses(
  id: string,
  parentID: string | undefined,
  overrides: Partial<SubagentSession> = {},
): SubagentSession {
  return { id, parentID, ...overrides };
}

/** root -> (a -> a1), b */
const TREE: SubagentSession[] = [
  ses("ses_root", undefined, { title: "root" }),
  ses("ses_a", "ses_root", {
    agent: "explore",
    outcome: "succeeded",
    time: { created: T0, updated: T0 + 10 },
  }),
  ses("ses_a1", "ses_a", {
    agent: "review",
    time: { created: T0, updated: T0 + 20 },
  }),
  ses("ses_b", "ses_root", {
    agent: "build",
    time: { created: T0, updated: T0 + 30 },
  }),
];

function row(overrides: Partial<SubagentRow> = {}): SubagentRow {
  return {
    id: "ses_x",
    label: "subagent",
    needsPermission: false,
    isCurrent: false,
    depth: 1,
    ...overrides,
  };
}

describe("collectSubagents root resolution", () => {
  it("returns every descendant of the root session, breadth first", () => {
    const rows = collectSubagents(TREE, "ses_root");
    expect(rows.map((r) => r.id)).toEqual(["ses_a", "ses_b", "ses_a1"]);
    expect(rows.map((r) => r.depth)).toEqual([1, 1, 2]);
  });

  it("never returns the root itself", () => {
    const rows = collectSubagents(TREE, "ses_root");
    expect(rows.some((r) => r.id === "ses_root")).toBe(false);
  });

  it("walks parentID up to the same root from a nested session", () => {
    const rows = collectSubagents(TREE, "ses_a1");
    expect(rows.map((r) => r.id)).toEqual(["ses_a", "ses_b", "ses_a1"]);
    expect(rows.filter((r) => r.isCurrent).map((r) => r.id)).toEqual(["ses_a1"]);
  });

  it("falls back to the current session when the chain is broken", () => {
    const orphan = ses("ses_orphan", "ses_missing");
    const rows = collectSubagents([...TREE, orphan], "ses_orphan");
    expect(rows).toEqual([]);
  });

  it("uses the current session as root when it is unknown", () => {
    expect(collectSubagents(TREE, "ses_ghost")).toEqual([]);
  });

  it("terminates on a cyclic parent chain", () => {
    const rows = collectSubagents([ses("ses_x", "ses_y"), ses("ses_y", "ses_x")], "ses_x");
    expect(rows.map((r) => r.id)).toEqual(["ses_x"]);
  });

  it("returns nothing for an empty list or a missing current id", () => {
    expect(collectSubagents([], "ses_root")).toEqual([]);
    expect(collectSubagents(TREE, "")).toEqual([]);
  });

  it("ignores records without a usable id", () => {
    const rows = collectSubagents([ses("", "ses_root"), ...TREE], "ses_root");
    expect(rows.map((r) => r.id)).not.toContain("");
  });
});

describe("collectSubagents row data", () => {
  it("maps model, tokens, cost and time from the record", () => {
    const rows = collectSubagents(
      [
        ses("ses_root", undefined),
        ses("ses_a", "ses_root", {
          model: { id: "claude-sonnet-4-6", providerID: "anthropic" },
          tokens: { input: 800, output: 199 },
          cost: 1.25,
          time: { created: T0, updated: T0 + 500 },
        }),
      ],
      "ses_root",
    );
    expect(rows[0]?.model).toBe("claude-sonnet-4-6");
    expect(rows[0]?.tokens).toBe(999);
    expect(rows[0]?.cost).toBe(1.25);
    expect(rows[0]?.time).toEqual({ created: T0, updated: T0 + 500 });
  });

  it("falls back to title and then to the default label", () => {
    const rows = collectSubagents(
      [
        ses("ses_root", undefined),
        ses("ses_a", "ses_root", { title: "Find TODOs" }),
        ses("ses_b", "ses_root"),
        ses("ses_c", "ses_root", { agent: "   ", title: "Nested" }),
      ],
      "ses_root",
    );
    expect(rows.map((r) => r.label)).toEqual(["Find TODOs", "subagent", "Nested"]);
  });

  it("leaves metrics undefined when the record has none", () => {
    const rows = collectSubagents([ses("ses_root", undefined), ses("ses_a", "ses_root")], "ses_root");
    expect(rows[0]?.model).toBeUndefined();
    expect(rows[0]?.tokens).toBeUndefined();
    expect(rows[0]?.cost).toBeUndefined();
    expect(rows[0]?.time).toBeUndefined();
  });

  it("sums only finite token fields", () => {
    const rows = collectSubagents(
      [
        ses("ses_root", undefined),
        ses("ses_a", "ses_root", { tokens: { input: Number.NaN, output: 10 } }),
        ses("ses_b", "ses_root", { cost: Number.NaN }),
      ],
      "ses_root",
    );
    expect(rows[0]?.tokens).toBe(10);
    expect(rows[1]?.cost).toBeUndefined();
  });

  it("injects the status and permission lookups per session", () => {
    const rows = collectSubagents(
      TREE,
      "ses_root",
      (id) => (id === "ses_b" ? "running" : undefined),
      (id) => id === "ses_a1",
    );
    expect(rows.find((r) => r.id === "ses_b")?.status).toBe("running");
    expect(rows.find((r) => r.id === "ses_a1")?.needsPermission).toBe(true);
    expect(rows.find((r) => r.id === "ses_a")?.needsPermission).toBe(false);
  });

  it("survives a throwing lookup", () => {
    const rows = collectSubagents(
      TREE,
      "ses_root",
      () => {
        throw new Error("data layer");
      },
      () => {
        throw new Error("data layer");
      },
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === undefined && !r.needsPermission)).toBe(true);
  });
});

describe("rowLabel through the panel path", () => {
  it("surfaces the title through collectSubagents, not just in isolation", () => {
    const rows = collectSubagents(
      [
        ses("ses_root", undefined),
        ses("ses_a", "ses_root", { agent: "general", title: "F4 context usage percent" }),
        ses("ses_b", "ses_root", { agent: "code", title: "fix the flaky parser test" }),
        ses("ses_c", "ses_root", { agent: "review-validator" }),
      ],
      "ses_root",
    );
    expect(rows.map((r) => r.label)).toEqual([
      "F4 context usage percent (general)",
      "fix the flaky parser test",
      "review-validator",
    ]);
  });
});

describe("orderRows", () => {
  it("puts permission-pending first, then running, then the rest", () => {
    const rows = [
      row({ id: "done", outcome: "succeeded", time: { created: T0, updated: T0 + 900 } }),
      row({ id: "idle", time: { created: T0, updated: T0 + 900 } }),
      row({ id: "running", status: "running", time: { created: T0, updated: T0 + 1 } }),
      row({ id: "perm", status: "running", needsPermission: true }),
    ];
    expect(orderRows(rows).map((r) => r.id)).toEqual(["perm", "running", "done", "idle"]);
  });

  it("orders the tail by most recent activity", () => {
    const rows = [
      row({ id: "old", time: { created: T0, updated: T0 } }),
      row({ id: "new", time: { created: T0, updated: T0 + 500 } }),
      row({ id: "none" }),
    ];
    expect(orderRows(rows).map((r) => r.id)).toEqual(["new", "old", "none"]);
  });

  it("keeps the input order for equal keys", () => {
    const rows = [row({ id: "first" }), row({ id: "second" })];
    expect(orderRows(rows).map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ id: "b", needsPermission: true }), row({ id: "a" })];
    orderRows(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("visibleRows", () => {
  const rows = [
    row({ id: "running", status: "running" }),
    row({ id: "unknown" }),
    row({ id: "done", outcome: "succeeded" }),
    row({ id: "failed", outcome: "failed" }),
    row({ id: "stopped", outcome: "interrupted" }),
  ];

  it("hides finished rows when completed are toggled off", () => {
    expect(visibleRows(rows, false).map((r) => r.id)).toEqual(["running", "unknown"]);
  });

  it("keeps a permission-pending row visible", () => {
    const pending = [row({ id: "perm", needsPermission: true })];
    expect(visibleRows(pending, false).map((r) => r.id)).toEqual(["perm"]);
  });

  it("keeps an idle row visible: idle is not terminal", () => {
    const idle = [row({ id: "idle", status: "idle" })];
    expect(visibleRows(idle, false).map((r) => r.id)).toEqual(["idle"]);
  });

  it("returns everything when completed are shown", () => {
    expect(visibleRows(rows, true).map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});

describe("topRows", () => {
  it("returns an empty list for no rows", () => {
    expect(topRows([])).toEqual([]);
  });

  it("returns a single row as it is", () => {
    const only = row({ id: "solo", label: "explore" });
    expect(topRows([only])).toEqual([only]);
  });

  it("keeps every row when there are exactly as many as the limit", () => {
    const rows = [
      row({ id: "perm", needsPermission: true }),
      row({ id: "running", status: "running" }),
      row({ id: "done", outcome: "succeeded" }),
    ];
    expect(topRows(rows).map((r) => r.id)).toEqual(["perm", "running", "done"]);
  });

  it("keeps the three that need attention out of four", () => {
    const rows = [
      row({ id: "idle", time: { created: T0, updated: T0 + 100 } }),
      row({ id: "done", outcome: "succeeded", time: { created: T0, updated: T0 + 800 } }),
      row({ id: "running", status: "running", time: { created: T0, updated: T0 + 1 } }),
      row({ id: "perm", status: "running", needsPermission: true }),
    ];
    expect(topRows(rows).map((r) => r.id)).toEqual(["perm", "running", "done"]);
  });

  it("caps a long list at the exported limit, in the panel's order", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({ id: `s${index}`, outcome: "succeeded", time: { created: T0, updated: T0 + index } }),
    );
    expect(topRows(rows)).toEqual(orderRows(rows).slice(0, SIDEBAR_LIMIT));
    expect(topRows(rows)).toHaveLength(SIDEBAR_LIMIT);
  });
});

describe("counts", () => {
  it("counts running, done and failed rows", () => {
    const rows = [
      row({ id: "a", status: "running" }),
      row({ id: "b", status: "running" }),
      row({ id: "c", outcome: "succeeded" }),
      row({ id: "d", outcome: "failed" }),
      row({ id: "e", outcome: "interrupted" }),
      row({ id: "f" }),
    ];
    expect(counts(rows)).toEqual({ running: 2, done: 1, failed: 2 });
  });

  it("returns zeroes for no rows", () => {
    expect(counts([])).toEqual({ running: 0, done: 0, failed: 0 });
  });
});

describe("stateOf", () => {
  it("prefers the outcome over the status", () => {
    expect(stateOf(row({ outcome: "succeeded", status: "running" }))).toBe("done");
    expect(stateOf(row({ outcome: "failed" }))).toBe("error");
    expect(stateOf(row({ outcome: "interrupted" }))).toBe("interrupted");
  });

  it("uses the status when there is no outcome", () => {
    expect(stateOf(row({ status: "running" }), T0)).toBe("running");
    expect(stateOf(row({ status: "idle" }))).toBe("idle");
    expect(stateOf(row())).toBe("unknown");
  });
});

describe("wrapLabel", () => {
  const W = 29;
  const I = "    ";

  it("leaves a label that fits on one line, with no indent", () => {
    expect(wrapLabel("F4 usage", W, 2, I)).toEqual(["F4 usage"]);
  });

  it("wraps at the last space that fits the width", () => {
    expect(wrapLabel("F4 context usage percent (general)", W, 2, I)).toEqual([
      "F4 context usage percent",
      `${I}(general)`,
    ]);
  });

  it("ellipsizes a single word longer than the width instead of hard-cutting it", () => {
    const [line] = wrapLabel("supercalifragilisticexpialidocious", W, 2, I);
    // A whole word on one line, ellipsized to fit the width exactly.
    expect(Array.from(line ?? "").length).toBe(W);
    expect(line?.endsWith("…")).toBe(true);
    expect(line).toBe("supercalifragilisticexpialid…");
  });

  it("ellipsizes the last allowed line when there is more content than maxLines", () => {
    // Nine words, two lines allowed: the first stops at the last space that fits
    // 29 columns, and everything left for the second is ellipsized to fit.
    const lines = wrapLabel("alpha bravo charlie delta echo foxtrot golf hotel india", W, 2, I);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("alpha bravo charlie delta");
    // `echo foxtrot golf hotel india` is 28 columns: the remainder happens to fit,
    // so nothing is dropped and the text is simply cut at the maxLines boundary.
    expect(lines[1]).toBe(`${I}echo foxtrot golf hotel india`);
  });

  it("ellipsizes when the remainder does not fit the width either", () => {
    const lines = wrapLabel("alpha bravo charlie delta echoing extraordinarily long words here", W, 2, I);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(Array.from(lines[1]?.slice(I.length) ?? "").length).toBe(W);
  });

  it("collapses runs of whitespace and trims the ends", () => {
    expect(wrapLabel("  alpha \t\n bravo   charlie  ", W, 1, I)).toEqual(["alpha bravo charlie"]);
    expect(wrapLabel("   ", W, 2, I)).toEqual([""]);
    expect(wrapLabel("", W, 2, I)).toEqual([""]);
  });

  it("indents every continuation line and only those", () => {
    const lines = wrapLabel("RDD review lens retry (review-reliability)", W, 2, I);
    expect(lines).toEqual(["RDD review lens retry", `${I}(review-reliability)`]);
    expect(lines[0]?.startsWith(I)).toBe(false);
  });

  it("degrades without throwing on a non-positive width or fewer than two lines", () => {
    expect(() => wrapLabel("alpha bravo", 0, 2, I)).not.toThrow();
    expect(() => wrapLabel("alpha bravo", -5, 2, I)).not.toThrow();
    expect(() => wrapLabel("alpha bravo", W, 1, I)).not.toThrow();
    expect(() => wrapLabel("alpha bravo", W, 0, I)).not.toThrow();
    expect(() => wrapLabel("alpha bravo", Number.NaN, Number.NaN, I)).not.toThrow();
    // No width, or no room for a continuation: one line, text intact.
    expect(wrapLabel("alpha bravo", 0, 2, I)).toEqual(["alpha bravo"]);
    expect(wrapLabel("alpha bravo", W, 1, I)).toEqual(["alpha bravo"]);
  });

  it("counts code points, so a multi-byte label is not cut mid-character", () => {
    const lines = wrapLabel("héllo wörld this is a fairly long label", W, 2, I);
    expect(lines.join("")).toContain("héllo");
    expect(lines.every((line) => !line.includes("�"))).toBe(true);
  });
});

describe("headerTitle", () => {
  it("shows the expanded arrow when the title is open", () => {
    expect(headerTitle("Subagents", true)).toBe("▾ Subagents");
  });

  it("shows the collapsed arrow when the title is closed", () => {
    expect(headerTitle("Subagents", false)).toBe("▸ Subagents");
  });

  it("renders nothing but the trimmed title when there is no title", () => {
    expect(headerTitle("", true)).toBe("");
    expect(headerTitle("   ", false)).toBe("");
  });

  it("puts the arrow and the title on one line, separated by a single space", () => {
    for (const expanded of [true, false]) {
      const line = headerTitle("Subagents", expanded);
      expect(line.split(" ")).toHaveLength(2);
      expect(Array.from(line).length).toBe(Array.from("Subagents").length + 2);
    }
  });
});

describe("drawsSidebarRows", () => {
  it("draws the rows only when expanded and there is something to draw", () => {
    expect(drawsSidebarRows(true, true)).toBe(true);
  });

  it("draws nothing when collapsed, however many subagents there are", () => {
    expect(drawsSidebarRows(false, true)).toBe(false);
    expect(drawsSidebarRows(false, false)).toBe(false);
  });

  it("draws nothing when there are no subagents, even expanded", () => {
    expect(drawsSidebarRows(true, false)).toBe(false);
  });
});

describe("rowParts", () => {
  it("splits the row into a state-colored label line and a subdued meta line", () => {
    const parts = rowParts(
      row({
        label: "explore",
        model: "claude-sonnet-4-6",
        tokens: 19_212,
        cost: 0.04,
        contextPercent: 37,
        outcome: "succeeded",
        time: { created: T0, updated: T0 + 154_000 },
      }),
      T0 + 154_000,
    );
    expect(parts.state).toBe("done");
    expect(parts.label).toEqual(["  [✓] explore · claude-sonnet-4-6"]);
    expect(parts.meta).toBe("      ↳ ⏱ 02:34  19,212 tok · $0.04 · 37% ctx");
  });

  it("brackets the marker of every state and reports the state it colors from", () => {
    const cases: readonly (readonly [Partial<SubagentRow>, State, string])[] = [
      [{ status: "running" }, "running", "[ ]"],
      [{ status: "idle" }, "idle", "[◌]"],
      [{ outcome: "succeeded" }, "done", "[✓]"],
      [{ outcome: "failed" }, "error", "[✕]"],
      [{ outcome: "interrupted" }, "interrupted", "[⊘]"],
      [{}, "unknown", "[○]"],
    ];
    for (const [overrides, state, marker] of cases) {
      const parts = rowParts(row(overrides), T0);
      expect(parts.state).toBe(state);
      expect(parts.label).toEqual([`  ${marker} subagent`]);
      expect(parts.meta).toBe("");
    }
  });

  it("marks the current session and indents the label and the meta line by depth", () => {
    const parts = rowParts(
      row({ label: "review", isCurrent: true, depth: 3, outcome: "succeeded", time: { created: T0, updated: T0 + 5_000 } }),
      T0 + 5_000,
    );
    expect(parts.label).toEqual(["› [✓]     review"]);
    expect(parts.meta).toBe("          ↳ ⏱ 00:05");
  });

  it("wraps a long label to a second line with the four-space indent", () => {
    const parts = rowParts(
      row({
        label: "RDD review lens retry (review-reliability)",
        tokens: 1_564,
        outcome: "succeeded",
        time: { created: T0, updated: T0 + 305_000 },
      }),
      T0 + 305_000,
      { cost: false },
    );
    expect(parts.label).toEqual(["  [✓] RDD review lens retry", "    (review-reliability)"]);
    expect(parts.meta).toBe("      ↳ ⏱ 05:05  1,564 tok");
  });

  it("ellipsizes the model away when the label alone fills both lines", () => {
    const parts = rowParts(
      row({ label: "RDD review lens retry (review-reliability)", model: "space-bunny-free" }),
      T0,
    );
    expect(parts.label).toEqual(["  [○] RDD review lens retry", "    (review-reliability) · space…"]);
  });

  it("drops the model segment entirely with `model: false`, wrapping unchanged", () => {
    const base = {
      label: "RDD review lens retry (review-reliability)",
      model: "space-bunny-free",
      tokens: 1_564,
      outcome: "succeeded" as const,
      time: { created: T0, updated: T0 + 305_000 },
    };
    const parts = rowParts(row(base), T0 + 305_000, { model: false });
    expect(parts.label).toEqual(["  [✓] RDD review lens retry", "    (review-reliability)"]);
    // Nothing else moves: same state, same meta, same wrapping.
    expect(parts.state).toBe("done");
    expect(parts.meta).toBe("      ↳ ⏱ 05:05  1,564 tok");
  });

  it("keeps the model by default and with `model: true`", () => {
    const base = { label: "docs", model: "space-bunny-free" };
    expect(rowParts(row(base), T0).label).toEqual(["  [○] docs · space-bunny-free"]);
    expect(rowParts(row(base), T0, {}).label).toEqual(["  [○] docs · space-bunny-free"]);
    expect(rowParts(row(base), T0, { model: true }).label).toEqual(["  [○] docs · space-bunny-free"]);
  });

  it("honours an explicit labelWidth in both directions", () => {
    const base = { label: "RDD review lens retry (review-reliability)", outcome: "succeeded" as const };
    // Wide enough to hold the whole label on one line.
    expect(rowParts(row(base), T0, { labelWidth: 60 }).label).toEqual([
      "  [✓] RDD review lens retry (review-reliability)",
    ]);
    // Narrower than the default: two lines, the second ellipsized to 12 columns.
    expect(rowParts(row(base), T0, { labelWidth: 12 }).label).toEqual([
      "  [✓] RDD review",
      "    lens retry …",
    ]);
    expect(Array.from("lens retry …").length).toBe(12);
  });

  it("does not throw on a non-positive or non-finite labelWidth", () => {
    const base = { label: "RDD review lens retry (review-reliability)", outcome: "succeeded" as const };
    for (const labelWidth of [0, -8, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rowParts(row(base), T0, { labelWidth })).not.toThrow();
      expect(rowParts(row(base), T0, { labelWidth }).label.length).toBeGreaterThan(0);
    }
    // A width that cannot be measured degrades to the text on one line, intact.
    expect(rowParts(row(base), T0, { labelWidth: 0 }).label).toEqual([
      "  [✓] RDD review lens retry (review-reliability)",
    ]);
  });

  it("takes no cost and no model together, keeping the continuation indent", () => {
    const parts = rowParts(
      row({
        label: "RDD review lens retry (review-reliability)",
        model: "space-bunny-free",
        tokens: 1_564,
        outcome: "succeeded",
        time: { created: T0, updated: T0 + 305_000 },
      }),
      T0 + 305_000,
      { cost: false, model: false },
    );
    expect(parts.label).toEqual(["  [✓] RDD review lens retry", "    (review-reliability)"]);
    expect(parts.meta).toBe("      ↳ ⏱ 05:05  1,564 tok");
    expect(parts.meta).not.toContain("$");
    expect(parts.label.join("")).not.toContain("space-bunny-free");
  });

  it("suppresses only the cost when only `cost: false` is asked for", () => {
    const parts = rowParts(row({ label: "docs", model: "space-bunny-free", cost: 0.04 }), T0, {
      cost: false,
    });
    expect(parts.label).toEqual(["  [○] docs · space-bunny-free"]);
    expect(parts.meta).toBe("");
  });

  it("keeps a short label on exactly one line", () => {
    expect(rowParts(row({ label: "docs" }), T0).label).toEqual(["  [○] docs"]);
  });

  it("puts the permission marker on the last label line", () => {
    const parts = rowParts(
      row({ label: "F4 context usage percent (general)", needsPermission: true }),
      T0,
    );
    expect(parts.label).toEqual(["  [○] F4 context usage percent", "    (general) ⚠"]);
  });

  it("still indents the first line by depth when the label wraps", () => {
    const parts = rowParts(
      row({ label: "F4 context usage percent (general)", depth: 3 }),
      T0,
    );
    expect(parts.label).toEqual(["  [○]     F4 context usage percent", "    (general)"]);
  });

  it("keeps the permission marker on the label line", () => {
    const parts = rowParts(row({ label: "plan", needsPermission: true }), T0);
    expect(parts.label).toEqual(["  [○] plan ⚠"]);
    expect(parts.meta).toBe("");
  });

  it("drops zero metrics and keeps the meta line free of the model", () => {
    const parts = rowParts(row({ label: "plan", model: "gpt-5", tokens: 0, cost: 0, time: { created: T0, updated: T0 } }), T0);
    expect(parts.label).toEqual(["  [○] plan · gpt-5"]);
    expect(parts.meta).toBe("      ↳ ⏱ 00:00");
  });

  it("drops a non-finite token count instead of printing 0 tok", () => {
    expect(rowParts(row({ label: "plan", tokens: Number.NaN }), T0).meta).toBe("");
    expect(rowParts(row({ label: "plan", tokens: Number.POSITIVE_INFINITY }), T0).meta).toBe("");
    expect(rowParts(row({ label: "plan", tokens: Number.NEGATIVE_INFINITY }), T0).meta).toBe("");
  });

  it("gates the cost and the context percentage, keeping that one last", () => {
    const withCost = rowParts(row({ label: "explore", tokens: 19_212, cost: 0.04 }), T0);
    expect(withCost.meta).toBe("      ↳ 19,212 tok · $0.04");
    const withPercent = rowParts(row({ label: "explore", contextPercent: 37 }), T0);
    expect(withPercent.meta).toBe("      ↳ 37% ctx");
    const withBoth = rowParts(row({ label: "explore", cost: 0.04, contextPercent: 37 }), T0);
    expect(withBoth.meta).toBe("      ↳ $0.04 · 37% ctx");
  });

  it("omits a missing or non-finite context percentage", () => {
    for (const contextPercent of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rowParts(row({ label: "plan", contextPercent }), T0).meta).toBe("");
    }
  });

  it("keeps the elapsed clock running and freezes it once the outcome is set", () => {
    const running = rowParts(row({ label: "plan", time: { created: T0, updated: T0 } }), T0 + 60_000);
    expect(running.meta).toBe("      ↳ ⏱ 01:00");
    const frozen = rowParts(row({ label: "plan", outcome: "succeeded", time: { created: T0, updated: T0 + 900_000 } }), T0 + 3_600_000);
    expect(frozen.meta).toBe("      ↳ ⏱ 15:00");
  });
});

describe("rowParts cost option", () => {
  const COSTED = {
    label: "general",
    model: "space-bunny-free",
    cost: 0.04,
    tokens: 277_871,
    contextPercent: 13,
    outcome: "succeeded" as const,
    time: { created: T0, updated: T0 + 2_194_000 },
  };

  it("keeps the cost when no options are passed", () => {
    expect(rowParts(row(COSTED), T0 + 2_194_000).meta).toBe(
      "      ↳ ⏱ 36:34  277,871 tok · $0.04 · 13% ctx",
    );
  });

  it("keeps the cost for an empty options object", () => {
    expect(rowParts(row(COSTED), T0 + 2_194_000, {}).meta).toBe(
      "      ↳ ⏱ 36:34  277,871 tok · $0.04 · 13% ctx",
    );
  });

  it("drops only the cost when it is switched off", () => {
    expect(rowParts(row(COSTED), T0 + 2_194_000, { cost: false }).meta).toBe(
      "      ↳ ⏱ 36:34  277,871 tok · 13% ctx",
    );
  });

  it("leaves the label line untouched when the cost is switched off", () => {
    const parts = rowParts(row(COSTED), T0 + 2_194_000, { cost: false });
    expect(parts.label).toEqual(["  [✓] general · space-bunny-free"]);
    expect(parts.state).toBe("done");
  });

  it("renders no meta line at all when a suppressed cost was the only metric", () => {
    expect(rowParts(row({ label: "plan", cost: 0.04 }), T0, { cost: false }).meta).toBe("");
    expect(rowParts(row({ label: "plan", cost: 0.04 }), T0).meta).toBe("      ↳ $0.04");
  });

  it("keeps the permission marker on the label line either way", () => {
    const pending = row({ label: "docs", needsPermission: true, cost: 0.04 });
    expect(rowParts(pending, T0, { cost: false }).label).toEqual(["  [○] docs ⚠"]);
    expect(rowParts(pending, T0, { cost: false }).meta).toBe("");
  });
});

describe("headerSegments", () => {
  it("returns the three counts, each with the token of its state", () => {
    expect(headerSegments({ running: 2, done: 1, failed: 1 })).toEqual([
      { text: "● 2 run", token: MARKERS.running.token, fallback: MARKERS.running.fallback },
      { text: "✓ 1 done", token: MARKERS.done.token, fallback: MARKERS.done.fallback },
      { text: "✕ 1 err", token: MARKERS.error.token, fallback: MARKERS.error.fallback },
    ]);
  });

  it("renders zeroes without hiding a segment", () => {
    expect(headerSegments({ running: 0, done: 0, failed: 0 }).map((segment) => segment.text)).toEqual([
      "● 0 run",
      "✓ 0 done",
      "✕ 0 err",
    ]);
  });

  it("keeps the error segment when only errors are present", () => {
    expect(headerSegments({ running: 0, done: 0, failed: 3 }).map((segment) => segment.text)).toEqual([
      "● 0 run",
      "✓ 0 done",
      "✕ 3 err",
    ]);
  });
});

describe("headerLine", () => {
  it("joins the header segments with the separator", () => {
    expect(headerLine({ running: 2, done: 1, failed: 0 })).toBe("● 2 run · ✓ 1 done · ✕ 0 err");
  });

  it("renders zeroes", () => {
    expect(headerLine({ running: 0, done: 0, failed: 0 })).toBe("● 0 run · ✓ 0 done · ✕ 0 err");
  });

  it("is exactly the segments the panel colors", () => {
    const total = { running: 1, done: 2, failed: 3 };
    expect(headerLine(total)).toBe(headerSegments(total).map((segment) => segment.text).join(" · "));
  });
});

describe("footerText", () => {
  it("reports nothing when the root has no subagents", () => {
    expect(footerText({ running: 0, done: 0, failed: 0 })).toBeUndefined();
  });

  it("reuses the header line as soon as one subagent is known", () => {
    expect(footerText({ running: 0, done: 1, failed: 0 })).toBe("● 0 run · ✓ 1 done · ✕ 0 err");
  });

  it("stays visible while work is running or has failed", () => {
    expect(footerText({ running: 2, done: 0, failed: 1 })).toBe("● 2 run · ✓ 0 done · ✕ 1 err");
  });

  it("is the header line, not a second text shape", () => {
    const total = { running: 2, done: 1, failed: 1 };
    expect(footerText(total)).toBe(headerLine(total));
  });
});
describe("rowWindow", () => {
  it("never scrolls a list that already fits", () => {
    expect(rowWindow(3, 2, 10)).toEqual({ start: 0, end: 3 });
    expect(rowWindow(1, 0, 1)).toEqual({ start: 0, end: 1 });
  });

  it("opens at the top with the cursor on the first row", () => {
    expect(rowWindow(10, 0, 4)).toEqual({ start: 0, end: 4 });
  });

  it("puts the last row in view without scrolling past the end", () => {
    expect(rowWindow(10, 9, 4, 6)).toEqual({ start: 6, end: 10 });
  });

  it("does not move while the cursor is inside the window", () => {
    expect(rowWindow(10, 2, 4, 1)).toEqual({ start: 1, end: 5 });
  });

  it("scrolls the minimum when the cursor steps past the window end", () => {
    expect(rowWindow(10, 4, 4, 0)).toEqual({ start: 1, end: 5 });
    expect(rowWindow(10, 7, 4, 0)).toEqual({ start: 4, end: 8 });
  });

  it("scrolls the minimum when the cursor steps past the window start", () => {
    expect(rowWindow(10, 0, 4, 3)).toEqual({ start: 0, end: 4 });
  });

  it("keeps the last window flush with the end of a long list", () => {
    expect(rowWindow(10, 7, 4, 6)).toEqual({ start: 6, end: 10 });
  });

  it("shows an empty list as an empty window", () => {
    expect(rowWindow(0, 0, 4)).toEqual({ start: 0, end: 0 });
    expect(rowWindow(0, 3, 4, 2)).toEqual({ start: 0, end: 0 });
  });

  it("clamps a capacity below one to a single row", () => {
    expect(rowWindow(10, 5, 0)).toEqual({ start: 5, end: 6 });
    expect(rowWindow(10, 5, -4)).toEqual({ start: 5, end: 6 });
    expect(rowWindow(10, 3, Number.NaN)).toEqual({ start: 3, end: 4 });
  });

  it("clamps a cursor outside the list instead of producing a bad index", () => {
    expect(rowWindow(10, 99, 4, 6)).toEqual({ start: 6, end: 10 });
    expect(rowWindow(10, -3, 4)).toEqual({ start: 0, end: 4 });
  });

  it("never reports a window wider than the list or out of range", () => {
    for (let raw = -2; raw <= 12; raw += 1) {
      for (const capacity of [0, 1, 3, 4, 40]) {
        for (const from of [-2, 0, 5, 99]) {
          const cursor = Math.min(Math.max(0, raw), 9);
          const { start, end } = rowWindow(10, raw, capacity, from);
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeLessThanOrEqual(10);
          expect(end - start).toBeLessThanOrEqual(Math.max(1, Math.min(capacity, 10)));
          expect(cursor).toBeLessThan(end);
          expect(cursor).toBeGreaterThanOrEqual(start);
        }
      }
    }
  });
});

describe("rowCapacity", () => {
  it("subtracts the chrome lines and divides by the lines per row", () => {
    expect(rowCapacity(20, 2, 2)).toBe(9);
    expect(rowCapacity(10, 1, 2)).toBe(8);
  });

  it("floors an odd height instead of rounding up into an overflow", () => {
    expect(rowCapacity(11, 2, 2)).toBe(4);
    expect(rowCapacity(7, 1, 2)).toBe(5);
  });

  it("keeps at least one row when nothing fits", () => {
    expect(rowCapacity(3, 2, 2)).toBe(1);
    expect(rowCapacity(2, 2, 2)).toBe(1);
    expect(rowCapacity(0, 2, 2)).toBe(1);
    expect(rowCapacity(-8, 2, 2)).toBe(1);
  });

  it("never reports NaN for a non-finite height or a bogus row cost", () => {
    expect(rowCapacity(Number.NaN, 2, 2)).toBe(1);
    expect(rowCapacity(Number.POSITIVE_INFINITY, 2, 2)).toBe(1);
    expect(rowCapacity(10, 0, 2)).toBe(8);
    expect(rowCapacity(10, Number.NaN, 2)).toBe(8);
  });

  it("ignores a negative chrome count instead of growing the window", () => {
    expect(rowCapacity(10, 2, -4)).toBe(5);
  });
});
