import { describe, expect, it } from "vitest";
import {
  collectSubagents,
  counts,
  footerText,
  headerLine,
  headerSegments,
  orderRows,
  rowParts,
  stateOf,
  visibleRows,
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
    expect(parts.label).toBe("  [✓] explore · claude-sonnet-4-6");
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
      expect(parts.label).toBe(`  ${marker} subagent`);
      expect(parts.meta).toBe("");
    }
  });

  it("marks the current session and indents the label and the meta line by depth", () => {
    const parts = rowParts(
      row({ label: "review", isCurrent: true, depth: 3, outcome: "succeeded", time: { created: T0, updated: T0 + 5_000 } }),
      T0 + 5_000,
    );
    expect(parts.label).toBe("› [✓]     review");
    expect(parts.meta).toBe("          ↳ ⏱ 00:05");
  });

  it("keeps the permission marker on the label line", () => {
    const parts = rowParts(row({ label: "plan", needsPermission: true }), T0);
    expect(parts.label).toBe("  [○] plan ⚠");
    expect(parts.meta).toBe("");
  });

  it("drops zero metrics and keeps the meta line free of the model", () => {
    const parts = rowParts(row({ label: "plan", model: "gpt-5", tokens: 0, cost: 0, time: { created: T0, updated: T0 } }), T0);
    expect(parts.label).toBe("  [○] plan · gpt-5");
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